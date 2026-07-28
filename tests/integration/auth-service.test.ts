import { beforeAll, describe, expect, it } from 'vitest'

import { authService } from '@/features/auth/server/auth-service'
import { hashPassword } from '@/lib/auth/password'
import { db } from '@/lib/db/prisma'
import { RATE_LIMITS, reset } from '@/lib/http/rate-limit'

/**
 * Credential authentication, against the local database.
 *
 * Requires `npm run dev:db` and `npm run db:seed`.
 */
const EMAIL = 'auth-test@example.com'
const PASSWORD = 'CorrectHorseBattery9!'

let organizationId: string
let userId: string

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ where: { slug: 'default' } })
  organizationId = organization.id

  const existing = await db.user.findFirst({ where: { email: EMAIL, deletedAt: undefined } })
  if (existing) await db.user.delete({ where: { id: existing.id } })

  const user = await db.user.create({
    data: {
      organizationId,
      email: EMAIL,
      name: 'Auth Test',
      passwordHash: await hashPassword(PASSWORD),
      status: 'ACTIVE',
      roleIds: [],
      passwordChangedAt: new Date(),
    },
  })
  userId = user.id

  await reset(RATE_LIMITS.login(EMAIL).key)
})

describe('authService.authenticate', () => {
  it('accepts the correct password', async () => {
    await reset(RATE_LIMITS.login(EMAIL).key)

    const result = await authService.authenticate({ email: EMAIL, password: PASSWORD })

    expect(result).not.toBeNull()
    expect(result?.email).toBe(EMAIL)
    expect(result?.organizationId).toBe(organizationId)
    expect(result?.sessionEpoch).toBeGreaterThan(0)
  })

  it('rejects the wrong password', async () => {
    await reset(RATE_LIMITS.login(EMAIL).key)

    const result = await authService.authenticate({ email: EMAIL, password: 'wrong-password-here' })

    expect(result).toBeNull()
  })

  it('rejects an unknown email without throwing', async () => {
    const result = await authService.authenticate({
      email: 'nobody@example.com',
      password: PASSWORD,
    })

    expect(result).toBeNull()
  })

  it('is case-insensitive on the email', async () => {
    await reset(RATE_LIMITS.login(EMAIL).key)

    const result = await authService.authenticate({
      email: EMAIL.toUpperCase(),
      password: PASSWORD,
    })

    expect(result).not.toBeNull()
  })

  it('refuses an INVITED account even with a valid password', async () => {
    await reset(RATE_LIMITS.login(EMAIL).key)
    await db.user.update({ where: { id: userId }, data: { status: 'INVITED' } })

    const result = await authService.authenticate({ email: EMAIL, password: PASSWORD })
    expect(result).toBeNull()

    // …and the UI is allowed to explain this particular case.
    expect(await authService.explainFailure(EMAIL)).toBe('PENDING_INVITE')

    await db.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } })
  })

  it('locks the account after repeated failures', async () => {
    await reset(RATE_LIMITS.login(EMAIL).key)
    await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } })

    const settings = await db.setting.findUniqueOrThrow({ where: { organizationId } })

    for (let attempt = 0; attempt < settings.maxFailedLogins; attempt += 1) {
      await reset(RATE_LIMITS.login(EMAIL).key)
      await authService.authenticate({ email: EMAIL, password: 'still-wrong' })
    }

    const locked = await db.user.findUniqueOrThrow({ where: { id: userId } })
    expect(locked.lockedUntil).not.toBeNull()
    expect(locked.failedLoginCount).toBeGreaterThanOrEqual(settings.maxFailedLogins)

    // Even the correct password is refused while locked.
    await reset(RATE_LIMITS.login(EMAIL).key)
    expect(await authService.authenticate({ email: EMAIL, password: PASSWORD })).toBeNull()

    await db.user.update({ where: { id: userId }, data: { failedLoginCount: 0, lockedUntil: null } })
  })

  it('clears the failure counter on success', async () => {
    await reset(RATE_LIMITS.login(EMAIL).key)
    await db.user.update({ where: { id: userId }, data: { failedLoginCount: 3 } })

    await authService.authenticate({ email: EMAIL, password: PASSWORD })

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.failedLoginCount).toBe(0)
    expect(user.lastLoginAt).not.toBeNull()
  })

  it('writes an audit row that never contains the attempted password', async () => {
    await reset(RATE_LIMITS.login(EMAIL).key)
    const secret = 'super-secret-attempt-value'

    await authService.authenticate({ email: EMAIL, password: secret })

    const entry = await db.auditLog.findFirst({
      where: { action: 'auth.login_failed', entityLabel: EMAIL },
      orderBy: { createdAt: 'desc' },
    })

    expect(entry).not.toBeNull()
    expect(JSON.stringify(entry)).not.toContain(secret)
  })
})
