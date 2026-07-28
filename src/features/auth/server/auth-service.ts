import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { verifyPassword } from '@/lib/auth/password'
import { db } from '@/lib/db/prisma'
import { RATE_LIMITS, consume, reset } from '@/lib/http/rate-limit'
import { logger } from '@/lib/logger'
import { systemContext } from '@/lib/authz/system-context'

/**
 * Credential authentication.
 *
 * All login logic lives here rather than in the Auth.js `authorize` callback, so
 * it is testable without going through NextAuth and so the audit and rate-limit
 * behaviour is in one readable place.
 *
 * ── The rule every failure path obeys ────────────────────────────────────────
 * Return `null`, never a reason. Distinguishing "no such user" from "wrong
 * password" is a free account-enumeration oracle. The one exception is the
 * INVITED state, handled at the UI layer, where a hint is worth more than the
 * marginal enumeration risk — that account cannot be signed into anyway, and
 * without the hint people file support tickets they cannot log in to file.
 */

export interface AuthenticateInput {
  email: string
  password: string
  ip?: string
  userAgent?: string
}

export interface AuthenticatedUser {
  id: string
  email: string
  name: string
  organizationId: string
  sessionEpoch: number
}

/** Distinguishes states the UI may safely explain from ones it must not. */
export type AuthFailureReason =
  | 'INVALID_CREDENTIALS'
  | 'RATE_LIMITED'
  | 'LOCKED'
  | 'PENDING_INVITE'
  | 'INACTIVE'

export class AuthService {
  async authenticate(input: AuthenticateInput): Promise<AuthenticatedUser | null> {
    const email = input.email.trim().toLowerCase()

    // Rate limit BEFORE any database work, so a credential-stuffing run costs an
    // index lookup rather than an Argon2 verification.
    const [byEmail, byIp] = await Promise.all([
      consume(RATE_LIMITS.login(email)),
      input.ip ? consume(RATE_LIMITS.loginIp(input.ip)) : Promise.resolve({ allowed: true } as const),
    ])

    if (!byEmail.allowed || !byIp.allowed) {
      logger.warn({ email, ip: input.ip }, 'login rate limited')
      await this.recordAttempt(AUDIT_ACTIONS.auth.rateLimited, email, input, null)
      return null
    }

    const user = await db.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        passwordHash: true,
        organizationId: true,
        sessionEpoch: true,
        failedLoginCount: true,
        lockedUntil: true,
      },
    })

    // No such user: still spend the Argon2 work so response latency does not
    // reveal existence. verifyPassword handles the null hash for exactly this.
    if (!user) {
      await verifyPassword(null, input.password)
      return null
    }

    const now = new Date()

    if (user.lockedUntil && user.lockedUntil > now) {
      await this.recordAttempt(AUDIT_ACTIONS.auth.loginLocked, email, input, user.organizationId, user.id)
      return null
    }

    if (user.status !== 'ACTIVE') {
      // Still spend the work — an inactive account must not be identifiable by timing.
      await verifyPassword(user.passwordHash, input.password)
      await this.recordAttempt(
        user.status === 'INVITED' ? AUDIT_ACTIONS.auth.loginInactive : AUDIT_ACTIONS.auth.loginInactive,
        email,
        input,
        user.organizationId,
        user.id,
      )
      return null
    }

    const valid = await verifyPassword(user.passwordHash, input.password)

    if (!valid) {
      await this.registerFailure(user, email, input)
      return null
    }

    // Success: clear the failure counters and the rate-limit bucket, so a
    // legitimate user who mistyped twice is not still throttled.
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: now,
        lastLoginIp: input.ip ?? null,
      },
    })
    await reset(RATE_LIMITS.login(email).key)

    await audit
      .recordDeferred(
        { ...systemContext(user.organizationId), actorId: user.id, actorEmail: user.email, actorName: user.name, actorType: 'user', ip: input.ip, userAgent: input.userAgent },
        AUDIT_ACTIONS.auth.loginSucceeded,
        { entityType: 'User', entityId: user.id, entityLabel: user.email, targetUserId: user.id },
      )
      .catch(() => undefined)

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      organizationId: user.organizationId,
      sessionEpoch: user.sessionEpoch,
    }
  }

  /**
   * Why a sign-in attempt failed, for UI messaging only.
   *
   * Deliberately called SEPARATELY from `authenticate`, and only after it has
   * already returned null — so the authentication path itself never branches on
   * a distinguishable reason. Returns PENDING_INVITE only, because that is the
   * single state where explaining helps the user more than it helps an attacker.
   */
  async explainFailure(email: string): Promise<AuthFailureReason> {
    const user = await db.user.findFirst({
      where: { email: email.trim().toLowerCase(), deletedAt: null },
      select: { status: true, lockedUntil: true },
    })

    if (!user) return 'INVALID_CREDENTIALS'
    if (user.status === 'INVITED') return 'PENDING_INVITE'
    if (user.lockedUntil && user.lockedUntil > new Date()) return 'LOCKED'
    if (user.status !== 'ACTIVE') return 'INACTIVE'
    return 'INVALID_CREDENTIALS'
  }

  private async registerFailure(
    user: { id: string; email: string; name: string; organizationId: string; failedLoginCount: number },
    email: string,
    input: AuthenticateInput,
  ): Promise<void> {
    const settings = await db.setting.findUnique({
      where: { organizationId: user.organizationId },
      select: { maxFailedLogins: true, lockoutMinutes: true },
    })

    const maxFailed = settings?.maxFailedLogins ?? 10
    const lockoutMinutes = settings?.lockoutMinutes ?? 15
    const attempts = user.failedLoginCount + 1
    const shouldLock = attempts >= maxFailed

    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: attempts,
        // Temporary, not permanent: a permanent lock on failed attempts is a
        // denial-of-service anyone can trigger against a known email address.
        lockedUntil: shouldLock ? new Date(Date.now() + lockoutMinutes * 60_000) : null,
      },
    })

    await this.recordAttempt(
      AUDIT_ACTIONS.auth.loginFailed,
      email,
      input,
      user.organizationId,
      user.id,
      { attempt: attempts, locked: shouldLock },
    )
  }

  private async recordAttempt(
    action: string,
    email: string,
    input: AuthenticateInput,
    organizationId: string | null,
    userId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    // A failed login for an unknown email has no organization to attribute to.
    // Skipping the audit row is correct — otherwise anyone could write unbounded
    // rows into the largest collection in the system by POSTing junk emails.
    if (!organizationId) return

    await audit
      .recordSystem(db, organizationId, action as never, {
        entityType: 'User',
        entityId: userId ?? null,
        entityLabel: email,
        targetUserId: userId ?? null,
        metadata: { ...metadata, ip: input.ip, userAgent: input.userAgent },
        actorName: email,
      })
      .catch((error) => logger.error({ err: error, action }, 'failed to record auth audit'))
  }
}

export const authService = new AuthService()
