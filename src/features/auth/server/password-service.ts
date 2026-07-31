import 'server-only'

import { PreconditionFailedError, ValidationError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { DEFAULT_POLICY, checkPassword } from '@/lib/auth/password-policy'
import { env } from '@/lib/config/env'
import { generateToken, hashToken } from '@/lib/crypto'
import { db } from '@/lib/db/prisma'
import { RATE_LIMITS, consume } from '@/lib/http/rate-limit'
import { notifications } from '@/lib/notifications/dispatcher'

import type { ResetPasswordInput } from '../schemas/auth.schema'

/**
 * Password reset and change.
 *
 * Three properties that are easy to skip and expensive to omit:
 *
 *   • Single use — `consumedAt` is set in the same transaction as the password
 *     write, so a replayed link fails.
 *   • sessionEpoch is bumped, so an attacker holding a stolen session loses it
 *     the moment the real owner resets.
 *   • A notification email is sent AFTER a successful change — often the only
 *     signal a user gets that their account was taken over.
 */
export class PasswordService {
  /**
   * Request a reset.
   *
   * Always resolves successfully, whether or not the account exists. The caller
   * shows one message either way — a distinguishable response here is a free
   * account-enumeration oracle.
   */
  async requestReset(email: string, meta: { ip?: string; userAgent?: string }): Promise<void> {
    const normalised = email.trim().toLowerCase()

    const [byEmail, byIp] = await Promise.all([
      consume(RATE_LIMITS.forgotPassword(normalised)),
      meta.ip ? consume(RATE_LIMITS.forgotPasswordIp(meta.ip)) : Promise.resolve({ allowed: true } as const),
    ])

    // Silently stop. Telling the caller they are rate limited would itself
    // confirm the address is worth rate limiting.
    if (!byEmail.allowed || !byIp.allowed) return

    const user = await db.user.findFirst({
      where: { email: normalised, status: 'ACTIVE', deletedAt: null },
      select: { id: true, email: true, name: true, organizationId: true },
    })

    if (!user) return

    const settings = await db.setting.findUnique({
      where: { organizationId: user.organizationId },
      select: { passwordResetTtlMinute: true },
    })
    const ttlMinutes = settings?.passwordResetTtlMinute ?? 30

    const rawToken = generateToken()

    await db.$transaction(async (tx) => {
      /**
       * Invalidate outstanding tokens so only the newest link works.
       *
       * The `OR` is load-bearing, and this swept nothing at all without it.
       * `consumedAt` is `DateTime?` with no default, so Prisma omits it on insert
       * and the field is ABSENT rather than null — and Prisma's MongoDB connector
       * reads `consumedAt: null` as "present *and* null", so it matched zero rows.
       * Every reset link ever issued stayed live for its full TTL.
       *
       * Same trap as `deletedAt`, which src/lib/db/soft-delete-extension.ts exists
       * to survive — but AuthToken is not one of its models and this is not that
       * field, so nothing was stamping it. Matching both shapes fixes old rows too,
       * where enforcing the invariant would have needed a backfill.
       */
      await tx.authToken.updateMany({
        where: {
          userId: user.id,
          type: 'PASSWORD_RESET',
          OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
        },
        data: { consumedAt: new Date() },
      })

      const token = await tx.authToken.create({
        data: {
          type: 'PASSWORD_RESET',
          userId: user.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
          requestIp: meta.ip ?? null,
          userAgent: meta.userAgent?.slice(0, 400) ?? null,
        },
        select: { id: true },
      })

      await audit.recordSystem(tx, user.organizationId, AUDIT_ACTIONS.auth.passwordResetRequested, {
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.email,
        targetUserId: user.id,
        metadata: { ip: meta.ip, userAgent: meta.userAgent },
        summary: `Password reset requested for ${user.email}`,
        actorName: user.email,
      })

      await notifications.enqueue(
        {
          templateKey: 'password-reset',
          organizationId: user.organizationId,
          idempotencyKey: `reset:${token.id}`,
          recipients: [{ email: user.email, name: user.name, userId: user.id }],
          payload: {
            email: user.email,
            resetUrl: `${env.APP_URL}/reset-password/${rawToken}`,
            expiresInMinutes: ttlMinutes,
            requestIp: meta.ip ?? null,
          },
          relatedEntityType: 'AuthToken',
          relatedEntityId: token.id,
        },
        tx,
      )
    })
  }

  /** Validate a reset token for the GET that renders the form. */
  async inspectResetToken(rawToken: string) {
    const token = await db.authToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        type: true,
        consumedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, name: true, status: true, organizationId: true } },
      },
    })

    if (!token || token.type !== 'PASSWORD_RESET') return { state: 'invalid' as const }
    if (token.consumedAt) return { state: 'used' as const }
    // Checked in code as well as by the TTL index: MongoDB's TTL monitor runs
    // about once a minute, so an expired row can briefly still exist.
    if (token.expiresAt <= new Date()) return { state: 'expired' as const }
    if (token.user.status !== 'ACTIVE') return { state: 'invalid' as const }

    return { state: 'valid' as const, token }
  }

  async completeReset(input: ResetPasswordInput, meta: { ip?: string; userAgent?: string }) {
    // Re-validate: the GET only proved the token was valid then, and the form
    // could be replayed.
    const inspected = await this.inspectResetToken(input.token)
    if (inspected.state !== 'valid') {
      throw new PreconditionFailedError('RESET_TOKEN_INVALID', { state: inspected.state })
    }

    const { token } = inspected
    const user = token.user

    const settings = await db.setting.findUnique({
      where: { organizationId: user.organizationId },
      select: { passwordMinLength: true, passwordRequireMixed: true },
    })

    const check = checkPassword(
      input.password,
      {
        minLength: settings?.passwordMinLength ?? DEFAULT_POLICY.minLength,
        requireMixed: settings?.passwordRequireMixed ?? DEFAULT_POLICY.requireMixed,
      },
      { email: user.email, name: user.name },
    )
    if (!check.ok) throw new ValidationError(check.problems[0]!, { password: check.problems })

    const current = await db.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    })

    if (await verifyPassword(current.passwordHash, input.password)) {
      throw new ValidationError('Choose a password you have not used before', {
        password: ['This is your current password'],
      })
    }

    const passwordHash = await hashPassword(input.password)
    const now = new Date()

    await db.$transaction(async (tx) => {
      // Single use, marked before the password write so a concurrent replay of
      // the same token cannot also succeed.
      await tx.authToken.update({ where: { id: token.id }, data: { consumedAt: now } })

      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: now,
          // Kills every existing session, including an attacker's.
          sessionEpoch: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
      })

      await audit.recordSystem(tx, user.organizationId, AUDIT_ACTIONS.auth.passwordResetCompleted, {
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.email,
        targetUserId: user.id,
        metadata: { ip: meta.ip, userAgent: meta.userAgent },
        summary: `${user.email} reset their password`,
        actorName: user.email,
      })

      await notifications.enqueue(
        {
          templateKey: 'password-changed',
          organizationId: user.organizationId,
          idempotencyKey: `pwchanged:${token.id}`,
          recipients: [{ email: user.email, name: user.name, userId: user.id }],
          payload: {
            email: user.email,
            changedAt: now.toISOString(),
            ip: meta.ip ?? null,
          },
          relatedEntityType: 'User',
          relatedEntityId: user.id,
        },
        tx,
      )
    })

    return { email: user.email }
  }
}

export const passwordService = new PasswordService()
