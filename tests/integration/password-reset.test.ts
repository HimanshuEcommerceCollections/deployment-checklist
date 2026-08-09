import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { passwordService } from '@/features/auth/server/password-service'
import { verifyPassword } from '@/lib/auth/password'
import { db } from '@/lib/db/prisma'

/**
 * Forgot password, end to end.
 *
 * The whole chain existed and had no test: request → token → outbox row → worker →
 * render → reset link → new password. Every part of it is a place where a silent
 * break looks identical to "the email is just slow", which is the worst possible
 * failure mode for the one flow a locked-out user has left.
 *
 * The account used here is created by the test rather than borrowed from the seed,
 * because completing a reset bumps `sessionEpoch` and rotates the password — doing
 * that to the seeded admin would break every other suite that signs in as them.
 *
 * Requires a seeded database.
 */
let organizationId: string
let userId: string
let userEmail: string

/**
 * Deliberately sharing nothing with the account's name or email. The policy
 * rejects a password containing either, and a fixture whose name echoes its
 * password fails on that rather than on what the test is actually checking.
 */
const FIRST_PASSWORD = 'Qv7-Harbour-Lantern-First!'
const SECOND_PASSWORD = 'Qv7-Harbour-Lantern-Second!'

const idempotencyKeys: string[] = []
/** Row ids already handed out, so "the new one" is never ambiguous. */
const seenRowIds = new Set<string>()

/** A dispatcher built against a specific email configuration. env.ts caches, so reload. */
async function loadDispatcher(overrides: Record<string, string> = {}) {
  vi.resetModules()
  vi.stubEnv('EMAIL_CONFIG_SOURCE', 'env')
  vi.stubEnv('EMAIL_ENABLED', 'true')
  /// console prints instead of sending. The point is to prove the row reaches a
  /// provider and renders, not to mail anyone from a test run.
  vi.stubEnv('EMAIL_PROVIDER', 'console')
  vi.stubEnv('NODE_ENV', 'development')
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value)

  const { notifications } = await import('@/lib/notifications/dispatcher')
  return notifications
}

/** The queue carries a seeded backlog, so drain until this row is actually done. */
async function drainUntilProcessed(
  notifications: Awaited<ReturnType<typeof loadDispatcher>>,
  idempotencyKey: string,
) {
  for (let pass = 0; pass < 20; pass += 1) {
    const result = await notifications.drain({ batchSize: 50 })

    const row = await db.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey },
      select: { status: true },
    })
    if (row.status !== 'PENDING') return

    if (result.claimed === 0) {
      throw new Error(`drain claimed nothing while ${idempotencyKey} was still PENDING`)
    }
  }
  throw new Error(`${idempotencyKey} was never processed`)
}

/**
 * Request a reset with the rate limiter cleared first.
 *
 * `forgotPassword` allows 5 per hour per address and, by design, returns silently
 * once tripped — telling the caller they are rate limited would itself confirm the
 * address is worth rate limiting. A suite that requests more than five times
 * therefore gets no token and no row, and fails somewhere unrelated. Clearing the
 * bucket keeps that behaviour intact in production and out of the way here.
 */
async function requestResetUnthrottled(email: string, meta: { ip?: string } = {}) {
  await db.rateLimit.deleteMany({
    where: {
      bucketKey: {
        in: [`forgot:${email.toLowerCase()}`, ...(meta.ip ? [`forgot:ip:${meta.ip}`] : [])],
      },
    },
  })

  await passwordService.requestReset(email, meta)
}

/**
 * The reset row from the request that just happened, with the token its email
 * carries.
 *
 * Excludes rows already returned rather than taking the newest by `createdAt`.
 * Two requests inside the same millisecond tie on that column, and the resulting
 * order is arbitrary — which made a passing assertion depend on timing.
 */
async function newResetRow() {
  const row = await db.notificationOutbox.findFirstOrThrow({
    where: {
      templateKey: 'password-reset',
      toAddresses: { has: userEmail },
      id: { notIn: [...seenRowIds] },
    },
    orderBy: { createdAt: 'desc' },
  })

  seenRowIds.add(row.id)
  idempotencyKeys.push(row.idempotencyKey)

  const payload = row.payload as { resetUrl?: string }
  const rawToken = payload.resetUrl?.split('/reset-password/')[1]

  return { row, rawToken }
}

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ where: { slug: 'default' } })
  organizationId = organization.id

  const { hashPassword } = await import('@/lib/auth/password')
  userEmail = `reset-flow-${Date.now()}@example.com`

  const user = await db.user.create({
    data: {
      organizationId,
      email: userEmail,
      name: 'Reset Target',
      status: 'ACTIVE',
      passwordHash: await hashPassword(FIRST_PASSWORD),
      roleIds: [],
    },
  })
  userId = user.id
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

afterAll(async () => {
  await db.authToken.deleteMany({ where: { userId } })
  await db.notificationOutbox.deleteMany({ where: { idempotencyKey: { in: idempotencyKeys } } })
  await db.notificationOutbox.deleteMany({ where: { toAddresses: { has: userEmail } } })
  await db.user.deleteMany({ where: { id: userId } })
})

describe('requesting a reset', () => {
  it('mints a single-use token and queues the email with a working link', async () => {
    await requestResetUnthrottled(userEmail, { ip: '203.0.113.10' })

    /// The OR matches whether consumedAt is absent or explicitly null — Prisma
    /// omits an optional field with no default on insert, so `consumedAt: null`
    /// alone does not match a fresh row on MongoDB.
    const tokens = await db.authToken.findMany({
      where: {
        userId,
        type: 'PASSWORD_RESET',
        OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
      },
    })
    expect(tokens).toHaveLength(1)
    expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now())
    /// The raw token is never stored — only its hash.
    expect(JSON.stringify(tokens[0])).not.toContain('reset-password/')

    const { row, rawToken } = await newResetRow()
    expect(row.status).toBe('PENDING')
    expect(rawToken).toBeTruthy()

    // The link in the email is the thing that has to work, not just any token.
    const inspected = await passwordService.inspectResetToken(rawToken!)
    expect(inspected.state).toBe('valid')
  })

  it('audits the request', async () => {
    const entry = await db.auditLog.findFirst({
      where: { action: 'auth.password_reset_requested', targetUserId: userId },
    })
    expect(entry).not.toBeNull()
    expect(entry?.summary).toContain(userEmail)
  })

  it('invalidates the previous link when a second is requested', async () => {
    /// Both requests are made here rather than reusing the row from an earlier
    /// test, so this holds whichever order the suite runs in.
    await requestResetUnthrottled(userEmail, { ip: '203.0.113.11' })
    const first = await newResetRow()

    await requestResetUnthrottled(userEmail, { ip: '203.0.113.11' })
    const second = await newResetRow()

    expect(second.rawToken).not.toBe(first.rawToken)
    // Only the newest link works — an older email in an inbox is dead.
    expect((await passwordService.inspectResetToken(first.rawToken!)).state).toBe('used')
    expect((await passwordService.inspectResetToken(second.rawToken!)).state).toBe('valid')
  })

  it('resolves silently for an address that does not exist', async () => {
    // A distinguishable response here is a free account-enumeration oracle.
    await expect(
      passwordService.requestReset('nobody-at-all@example.com', {}),
    ).resolves.toBeUndefined()

    const queued = await db.notificationOutbox.count({
      where: { toAddresses: { has: 'nobody-at-all@example.com' } },
    })
    expect(queued).toBe(0)
  })

  it('does nothing for an account that has not accepted its invite', async () => {
    const invited = await db.user.create({
      data: {
        organizationId,
        email: `reset-invited-${Date.now()}@example.com`,
        name: 'Not Yet Active',
        status: 'INVITED',
        roleIds: [],
      },
    })

    try {
      await passwordService.requestReset(invited.email, {})

      const tokens = await db.authToken.count({
        where: { userId: invited.id, type: 'PASSWORD_RESET' },
      })
      expect(tokens).toBe(0)
    } finally {
      await db.authToken.deleteMany({ where: { userId: invited.id } })
      await db.user.deleteMany({ where: { id: invited.id } })
    }
  })
})

describe('the worker actually delivers it', () => {
  it('renders and hands the reset email to the provider', async () => {
    const notifications = await loadDispatcher()

    await requestResetUnthrottled(userEmail, { ip: '203.0.113.12' })
    const { row } = await newResetRow()

    await drainUntilProcessed(notifications, row.idempotencyKey)

    const after = await db.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: row.idempotencyKey },
    })

    expect(after.status).toBe('SENT')
    expect(after.sentAt).not.toBeNull()
    /**
     * lastError null is the part that matters. A row skipped because email is
     * switched off is ALSO marked SENT, with the reason parked here — which is why
     * "status: SENT" alone is not evidence anything was delivered.
     */
    expect(after.lastError).toBeNull()
  })

  it('dead-letters the row as recoverable when email is switched off', async () => {
    const notifications = await loadDispatcher({ EMAIL_ENABLED: 'false' })

    await requestResetUnthrottled(userEmail, { ip: '203.0.113.13' })
    const { row } = await newResetRow()

    await drainUntilProcessed(notifications, row.idempotencyKey)

    const after = await db.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: row.idempotencyKey },
    })

    // DEAD, not SENT: it was never delivered, so marking it SENT was a lie that
    // also let the 30-day TTL prune it and the retry route refuse it. DEAD is
    // retryable the moment a provider exists, and nothing is lost.
    expect(after.status).toBe('DEAD')
    expect(after.lastError).toMatch(/email disabled/i)
    expect(after.payload).toMatchObject({ email: userEmail })
  })
})

describe('completing the reset', () => {
  it('changes the password, consumes the token and revokes every session', async () => {
    await requestResetUnthrottled(userEmail, { ip: '203.0.113.14' })
    const { rawToken } = await newResetRow()

    const before = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { sessionEpoch: true },
    })

    const result = await passwordService.completeReset(
      { token: rawToken!, password: SECOND_PASSWORD } as never,
      { ip: '203.0.113.14' },
    )
    expect(result.email).toBe(userEmail)

    const after = await db.user.findUniqueOrThrow({ where: { id: userId } })

    expect(await verifyPassword(after.passwordHash, SECOND_PASSWORD)).toBe(true)
    expect(await verifyPassword(after.passwordHash, FIRST_PASSWORD)).toBe(false)
    // Kills every existing session, including an attacker's.
    expect(after.sessionEpoch).toBe(before.sessionEpoch + 1)
    expect(after.passwordChangedAt).not.toBeNull()
    expect(after.lockedUntil).toBeNull()
    expect(after.failedLoginCount).toBe(0)

    expect((await passwordService.inspectResetToken(rawToken!)).state).toBe('used')
  })

  it('refuses to reuse a consumed link', async () => {
    await requestResetUnthrottled(userEmail, {})
    const { rawToken } = await newResetRow()

    await passwordService.completeReset(
      { token: rawToken!, password: `Reuse-Guard-${Date.now()}!` } as never,
      {},
    )

    await expect(
      passwordService.completeReset(
        { token: rawToken!, password: `Reuse-Again-${Date.now()}!` } as never,
        {},
      ),
    ).rejects.toThrow()
  })

  it('refuses a token that was never issued', async () => {
    await expect(
      passwordService.completeReset(
        { token: 'not-a-real-token', password: 'Whatever-Valid-2026!' } as never,
        {},
      ),
    ).rejects.toThrow()
  })

  it('refuses the password the account already has', async () => {
    const current = `Current-Password-${Date.now()}!`

    await requestResetUnthrottled(userEmail, {})
    const first = await newResetRow()
    await passwordService.completeReset(
      { token: first.rawToken!, password: current } as never,
      {},
    )

    await requestResetUnthrottled(userEmail, {})
    const second = await newResetRow()

    await expect(
      passwordService.completeReset(
        { token: second.rawToken!, password: current } as never,
        {},
      ),
    ).rejects.toThrow(/not used before|current password/i)
  })

  it('queues the password-changed warning', async () => {
    // Often the only signal a user gets that their account was taken over, which
    // is why it is not optional.
    const queued = await db.notificationOutbox.findFirst({
      where: { templateKey: 'password-changed', toAddresses: { has: userEmail } },
      orderBy: { createdAt: 'desc' },
    })

    expect(queued).not.toBeNull()
    if (queued) idempotencyKeys.push(queued.idempotencyKey)
  })

  it('audits the completion', async () => {
    const entry = await db.auditLog.findFirst({
      where: { action: 'auth.password_reset_completed', targetUserId: userId },
    })
    expect(entry).not.toBeNull()
  })
})
