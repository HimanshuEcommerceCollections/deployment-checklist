import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { invitationService } from '@/features/auth/server/invitation-service'
import { passwordService } from '@/features/auth/server/password-service'
import { authService } from '@/features/auth/server/auth-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { db } from '@/lib/db/prisma'
import { RATE_LIMITS, reset } from '@/lib/http/rate-limit'

/**
 * The invite-only onboarding flow, end to end at the service layer.
 *
 * Requires `npm run dev:db` and `npm run db:seed`.
 */
const INVITEE = 'invitee-test@example.com'
const NEW_PASSWORD = 'FreshPassphrase42!'

let organizationId: string
let adminCtx: RequestContext
let engineerRoleId: string

/** Pull the emailed token out of the outbox row — it is never stored raw. */
async function tokenFromOutbox(invitationId: string): Promise<string> {
  const row = await db.notificationOutbox.findFirstOrThrow({
    where: { relatedEntityType: 'Invitation', relatedEntityId: invitationId },
    orderBy: { createdAt: 'desc' },
  })
  const payload = row.payload as { acceptUrl: string }
  return payload.acceptUrl.split('/accept-invite/')[1]!
}

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ where: { slug: 'default' } })
  organizationId = organization.id

  const adminRole = await db.role.findFirstOrThrow({ where: { organizationId, key: 'admin' } })
  // 'engineer' replaced 'developer' when the seeded roles were consolidated.
  const engineerRole = await db.role.findFirstOrThrow({ where: { organizationId, key: 'engineer' } })
  engineerRoleId = engineerRole.id

  const admin = await db.user.findFirstOrThrow({ where: { organizationId, roleIds: { has: adminRole.id } } })

  adminCtx = {
    actorId: admin.id,
    actorType: 'user',
    actorEmail: admin.email,
    actorName: admin.name,
    organizationId,
    roleKeys: ['admin'],
    permissions: { global: new Set(['*']), byProject: new Map(), isSuperAdmin: true },
    requestId: 'test-request',
    ip: '203.0.113.10',
    timezone: 'UTC',
  }
})

beforeEach(async () => {
  // Clear prior runs so each test starts from a known state.
  const stale = await db.user.findMany({ where: { email: INVITEE, deletedAt: undefined } })
  for (const user of stale) {
    await db.membership.deleteMany({ where: { userId: user.id } })
    await db.authToken.deleteMany({ where: { userId: user.id } })
    await db.user.delete({ where: { id: user.id } })
  }
  await db.invitation.deleteMany({ where: { email: INVITEE } })
  await reset(RATE_LIMITS.invite(adminCtx.actorId).key)
  await reset(RATE_LIMITS.login(INVITEE).key)
})

describe('invite → accept', () => {
  it('creates an INVITED user and queues exactly one email', async () => {
    const { invitation, userId } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      name: 'Test Invitee',
      roleIds: [engineerRoleId],
      projectGrants: [],
      message: 'Welcome to the team',
    })

    const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
    expect(user.status).toBe('INVITED')
    // No password until they accept — that is what makes it invite-only.
    expect(user.passwordHash).toBeNull()

    const queued = await db.notificationOutbox.findMany({
      where: { relatedEntityType: 'Invitation', relatedEntityId: invitation.id },
    })
    expect(queued).toHaveLength(1)
    expect(queued[0]!.templateKey).toBe('user-invite')
    expect(queued[0]!.toAddresses).toEqual([INVITEE])
  })

  it('stores only the token hash, never the raw token', async () => {
    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })

    const raw = await tokenFromOutbox(invitation.id)
    const stored = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })

    expect(raw.length).toBeGreaterThan(20)
    expect(stored.tokenHash).not.toBe(raw)
    // A database dump must not yield a usable invite link.
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('accepts the invitation, activating the account', async () => {
    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })
    const token = await tokenFromOutbox(invitation.id)

    expect((await invitationService.inspectToken(token)).state).toBe('valid')

    const user = await invitationService.accept(
      { token, name: 'Accepted Name', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      { ip: '203.0.113.20' },
    )

    expect(user.name).toBe('Accepted Name')

    const stored = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(stored.status).toBe('ACTIVE')
    expect(stored.passwordHash).not.toBeNull()
    expect(stored.roleIds).toContain(engineerRoleId)

    // The new credentials work immediately.
    await reset(RATE_LIMITS.login(INVITEE).key)
    expect(await authService.authenticate({ email: INVITEE, password: NEW_PASSWORD })).not.toBeNull()
  })

  it('burns the token — a replayed link fails', async () => {
    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })
    const token = await tokenFromOutbox(invitation.id)

    await invitationService.accept(
      { token, name: 'First Use', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      {},
    )

    expect((await invitationService.inspectToken(token)).state).toBe('used')
    await expect(
      invitationService.accept(
        { token, name: 'Second Use', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
        {},
      ),
    ).rejects.toThrow()
  })

  it('applies project grants on acceptance', async () => {
    const project = await db.project.findFirstOrThrow({ where: { organizationId, key: 'APEX' } })

    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [{ projectId: project.id, roleId: engineerRoleId }],
    })
    const token = await tokenFromOutbox(invitation.id)

    const user = await invitationService.accept(
      { token, name: 'Scoped User', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      {},
    )

    const memberships = await db.membership.findMany({ where: { userId: user.id } })
    expect(memberships).toHaveLength(1)
    expect(memberships[0]!.projectId).toBe(project.id)
  })

  it('rejects a weak password against the org policy', async () => {
    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })
    const token = await tokenFromOutbox(invitation.id)

    await expect(
      invitationService.accept(
        { token, name: 'Weak', password: 'password', confirmPassword: 'password' },
        {},
      ),
    ).rejects.toThrow()

    // The invitation must remain usable after a rejected attempt.
    expect((await invitationService.inspectToken(token)).state).toBe('valid')
  })

  it('invalidates the previous token when re-invited', async () => {
    const first = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })
    const firstToken = await tokenFromOutbox(first.invitation.id)

    const second = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })
    const secondToken = await tokenFromOutbox(second.invitation.id)

    // Only the newest link works — a resend must not leave two valid tokens alive.
    expect((await invitationService.inspectToken(firstToken)).state).toBe('revoked')
    expect((await invitationService.inspectToken(secondToken)).state).toBe('valid')
  })

  it('reports an expired invitation distinctly', async () => {
    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })
    const token = await tokenFromOutbox(invitation.id)

    await db.invitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })

    expect((await invitationService.inspectToken(token)).state).toBe('expired')
    // …and the record is marked so the admin list stops showing PENDING.
    const stored = await db.invitation.findUniqueOrThrow({ where: { id: invitation.id } })
    expect(stored.status).toBe('EXPIRED')
  })

  it('rejects an invalid token without leaking whether it existed', async () => {
    expect((await invitationService.inspectToken('completely-made-up')).state).toBe('invalid')
  })

  it('refuses to invite an already-active user', async () => {
    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })
    const token = await tokenFromOutbox(invitation.id)
    await invitationService.accept(
      { token, name: 'Active', password: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      {},
    )

    await expect(
      invitationService.invite(adminCtx, {
        email: INVITEE,
        roleIds: [engineerRoleId],
        projectGrants: [],
      }),
    ).rejects.toThrow()
  })

  it('audits the invitation with the acting admin', async () => {
    const { invitation } = await invitationService.invite(adminCtx, {
      email: INVITEE,
      roleIds: [engineerRoleId],
      projectGrants: [],
    })

    const entry = await db.auditLog.findFirst({
      where: { action: 'user.invited', entityId: invitation.id },
    })

    expect(entry).not.toBeNull()
    expect(entry!.actorEmail).toBe(adminCtx.actorEmail)
    expect(entry!.ip).toBe(adminCtx.ip)
    expect(entry!.summary).toContain(INVITEE)
  })

  /**
   * Privilege escalation guard. Without it, `user.invite` is enough to mint
   * yourself an admin: invite a throwaway address as Admin, accept it, done.
   */
  it('refuses to grant a role exceeding the inviter’s own access', async () => {
    const adminRole = await db.role.findFirstOrThrow({ where: { organizationId, key: 'admin' } })

    const limitedCtx: RequestContext = {
      ...adminCtx,
      permissions: {
        global: new Set(['user.invite', 'user.read']),
        byProject: new Map(),
        isSuperAdmin: false,
      },
    }

    await expect(
      invitationService.invite(limitedCtx, {
        email: INVITEE,
        roleIds: [adminRole.id],
        projectGrants: [],
      }),
    ).rejects.toThrow(/exceeds your own access|cannot grant/i)
  })
})

describe('password reset', () => {
  const RESET_EMAIL = 'reset-test@example.com'

  it('does not reveal whether the account exists', async () => {
    await reset(RATE_LIMITS.forgotPassword('nobody-at-all@example.com').key)
    // Resolves quietly for an unknown address — same outcome as a known one.
    await expect(
      passwordService.requestReset('nobody-at-all@example.com', {}),
    ).resolves.toBeUndefined()

    expect(
      await db.notificationOutbox.count({ where: { toAddresses: { has: 'nobody-at-all@example.com' } } }),
    ).toBe(0)
  })

  it('issues a single-use token that revokes every session', async () => {
    // Arrange an active user to reset.
    const existing = await db.user.findMany({ where: { email: RESET_EMAIL, deletedAt: undefined } })
    for (const u of existing) {
      await db.authToken.deleteMany({ where: { userId: u.id } })
      await db.user.delete({ where: { id: u.id } })
    }

    const { hashPassword } = await import('@/lib/auth/password')
    const user = await db.user.create({
      data: {
        organizationId,
        email: RESET_EMAIL,
        name: 'Reset Test',
        passwordHash: await hashPassword('OldPassphrase99!'),
        status: 'ACTIVE',
        roleIds: [],
      },
    })

    await reset(RATE_LIMITS.forgotPassword(RESET_EMAIL).key)
    await passwordService.requestReset(RESET_EMAIL, { ip: '203.0.113.30' })

    const queued = await db.notificationOutbox.findFirstOrThrow({
      where: { templateKey: 'password-reset', toAddresses: { has: RESET_EMAIL } },
      orderBy: { createdAt: 'desc' },
    })
    const resetUrl = (queued.payload as { resetUrl: string }).resetUrl
    const token = resetUrl.split('/reset-password/')[1]!

    expect((await passwordService.inspectResetToken(token)).state).toBe('valid')

    const epochBefore = user.sessionEpoch
    await passwordService.completeReset(
      { token, password: 'BrandNewPassphrase77!', confirmPassword: 'BrandNewPassphrase77!' },
      { ip: '203.0.113.30' },
    )

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    // Every outstanding session — including an attacker's — is invalidated.
    expect(after.sessionEpoch).toBeGreaterThan(epochBefore)

    // Single use.
    expect((await passwordService.inspectResetToken(token)).state).toBe('used')

    // The owner is told, which is often the only sign of a takeover.
    expect(
      await db.notificationOutbox.count({
        where: { templateKey: 'password-changed', toAddresses: { has: RESET_EMAIL } },
      }),
    ).toBeGreaterThan(0)

    // No cascade deletes by design (docs/10 §10.7), so children go first —
    // exactly what a real purge routine has to do.
    await db.authToken.deleteMany({ where: { userId: user.id } })
    await db.user.delete({ where: { id: user.id } })
  })
})
