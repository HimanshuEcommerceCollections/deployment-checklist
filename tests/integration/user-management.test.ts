import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { usersService } from '@/features/admin/server/users-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { PERMISSIONS, SEED_ROLES, WILDCARD } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * Managing a user from the admin surface.
 *
 * Until the detail page existed, `updateUser` and `deleteUser` had no caller —
 * roles were set at invite time or through `npm run set:role`. That is why
 * `LAST_SUPER_ADMIN` sat unused in the error vocabulary since Phase 1: the
 * situation was unreachable. A form that can clear someone's roles or suspend
 * them makes locking the whole organization out a single click, so the guard and
 * these tests arrive with it.
 *
 * Requires a seeded database.
 */
let organizationId: string
let adminCtx: RequestContext
let superRoleId: string
let engineerRoleId: string
let projectOnlyRoleId: string | null = null

const createdUserIds: string[] = []
const createdRoleIds: string[] = []
const createdInvitationIds: string[] = []

function ctxFor(roleKey: string, actorId: string): RequestContext {
  const role = SEED_ROLES.find((r) => r.key === roleKey)
  if (!role) throw new Error(`No seeded role "${roleKey}"`)

  return {
    actorId,
    actorType: 'user',
    actorEmail: `${roleKey}@example.com`,
    actorName: roleKey,
    organizationId,
    roleKeys: [roleKey],
    permissions: {
      global: new Set<string>(role.permissions),
      byProject: new Map(),
      isSuperAdmin: 'isSuperAdmin' in role ? Boolean(role.isSuperAdmin) : false,
    },
    requestId: `test-${roleKey}`,
    timezone: 'UTC',
  }
}

/**
 * `updateUser` input with the permission overrides defaulted.
 *
 * They are required on the parsed type — the schema defaults them at the boundary,
 * so anything reaching the service has them — and most of these tests are about
 * roles or status rather than per-user permissions.
 */
function update(input: {
  name: string
  status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'
  roleIds: string[]
  extraPermissions?: string[]
  revokedPermissions?: string[]
}) {
  return {
    ...input,
    extraPermissions: (input.extraPermissions ?? []) as never,
    revokedPermissions: (input.revokedPermissions ?? []) as never,
  }
}

async function newUser(over: Partial<{ status: string; roleIds: string[] }> = {}) {
  const user = await db.user.create({
    data: {
      organizationId,
      email: `user-mgmt-${createdUserIds.length}-${Date.now()}@example.com`,
      name: 'Managed Account',
      status: (over.status ?? 'ACTIVE') as never,
      roleIds: over.roleIds ?? [],
    },
  })
  createdUserIds.push(user.id)
  return user
}

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ where: { slug: 'default' } })
  organizationId = organization.id

  /**
   * The seeded admin by address, not "the first ACTIVE user".
   *
   * Without an orderBy that returns whoever Mongo feels like, and this suite
   * creates Invitations carrying `invitedById` — which is a REQUIRED relation. Land
   * on another suite's fixture and its own hard-delete cleanup starts failing on a
   * foreign key, taking that whole file down with it.
   */
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase()
  const admin = await db.user.findFirstOrThrow({
    where: { organizationId, email: adminEmail, deletedAt: null },
  })
  adminCtx = ctxFor('admin', admin.id)

  superRoleId = (
    await db.role.findFirstOrThrow({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ isSuperAdmin: true }, { permissions: { has: WILDCARD } }],
      },
    })
  ).id

  engineerRoleId = (
    await db.role.findFirstOrThrow({ where: { organizationId, key: 'engineer', deletedAt: null } })
  ).id
})

afterAll(async () => {
  /// Invitations first: `invitedById` is a required relation, so a user cannot be
  /// hard-deleted while one still points at them.
  await db.invitation.deleteMany({ where: { id: { in: createdInvitationIds } } })
  await db.notificationOutbox.deleteMany({
    where: { relatedEntityId: { in: createdInvitationIds } },
  })
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } })
  await db.role.deleteMany({ where: { id: { in: createdRoleIds } } })
})

describe('changing roles and status', () => {
  it('grants an organization-wide role to an existing user', async () => {
    const user = await newUser()

    const updated = await usersService.updateUser(adminCtx, user.id, update({
      name: 'Managed Account',
      status: 'ACTIVE',
      roleIds: [engineerRoleId],
    }))

    expect(updated.roleIds).toEqual([engineerRoleId])
  })

  it('revokes live sessions when roles change', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Managed Account',
      status: 'ACTIVE',
      roleIds: [],
    }))

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    /// Roles resolve per request but the token carries the epoch, so without the
    /// bump a revoked role keeps working until the JWT ages out.
    expect(after.sessionEpoch).toBe(user.sessionEpoch + 1)
  })

  it('revokes live sessions when the account is suspended', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Managed Account',
      status: 'SUSPENDED',
      roleIds: [engineerRoleId],
    }))

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.status).toBe('SUSPENDED')
    expect(after.sessionEpoch).toBe(user.sessionEpoch + 1)
  })

  it('clears the lockout when reactivating', async () => {
    const user = await newUser({ status: 'SUSPENDED' })
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 900_000) },
    })

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Managed Account',
      status: 'ACTIVE',
      roleIds: [],
    }))

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.lockedUntil).toBeNull()
    expect(after.failedLoginCount).toBe(0)
  })

  it('does not bump the epoch for a rename alone', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Renamed Only',
      status: 'ACTIVE',
      roleIds: [engineerRoleId],
    }))

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.name).toBe('Renamed Only')
    // Signing someone out because an admin fixed a typo would be hostile.
    expect(after.sessionEpoch).toBe(user.sessionEpoch)
  })

  it('refuses a role that does not exist in this organization', async () => {
    const user = await newUser()

    await expect(
      usersService.updateUser(adminCtx, user.id, update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: ['ffffffffffffffffffffffff'],
      })),
    ).rejects.toThrow()
  })

  it('accepts any role organization-wide now that there is one way to grant one', async () => {
    /**
     * This used to refuse a role flagged `isAssignableGlobally: false`. That flag
     * existed to separate org-wide grants from per-project ones, and with roles
     * living on the user and assignment carrying no role, "assignable here but not
     * there" has nothing left to mean. docs/14 §14.9.
     */
    const role = await db.role.create({
      data: {
        organizationId,
        key: `formerly-project-only-${Date.now()}`,
        name: 'Formerly Project Only',
        permissions: [PERMISSIONS.deployment.read],
        isAssignableGlobally: false,
      },
    })
    createdRoleIds.push(role.id)
    projectOnlyRoleId = role.id

    const user = await newUser()

    const updated = await usersService.updateUser(
      adminCtx,
      user.id,
      update({ name: 'Managed Account', status: 'ACTIVE', roleIds: [projectOnlyRoleId] }),
    )

    expect(updated.roleIds).toEqual([projectOnlyRoleId])
  })
})

describe('per-user permissions on top of a role', () => {
  it('grants an extra permission the role does not include', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    const updated = await usersService.updateUser(
      adminCtx,
      user.id,
      update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [engineerRoleId],
        extraPermissions: [PERMISSIONS.deployment.rollback],
      }),
    )

    expect(updated.extraPermissions).toEqual([PERMISSIONS.deployment.rollback])
  })

  it('withholds a permission the role does grant', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    const updated = await usersService.updateUser(
      adminCtx,
      user.id,
      update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [engineerRoleId],
        revokedPermissions: [PERMISSIONS.deployment.create],
      }),
    )

    expect(updated.revokedPermissions).toEqual([PERMISSIONS.deployment.create])
  })

  it('restores a revoked permission when a newly assigned role grants it', async () => {
    /**
     * The rule from the specification, end to end through the service.
     *
     * `deployment.read` rather than the specification's `create`: the seeded QA role
     * does not grant create, and a test asserting a restore has to revoke something
     * the incoming role actually has. Both Engineer and QA grant read.
     */
    const qaRoleId = (
      await db.role.findFirstOrThrow({ where: { organizationId, key: 'qa', deletedAt: null } })
    ).id

    const user = await newUser({ roleIds: [engineerRoleId] })

    await usersService.updateUser(
      adminCtx,
      user.id,
      update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [engineerRoleId],
        revokedPermissions: [PERMISSIONS.deployment.read],
        extraPermissions: [PERMISSIONS.deployment.export],
      }),
    )

    const after = await usersService.updateUser(
      adminCtx,
      user.id,
      update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [qaRoleId],
        revokedPermissions: [PERMISSIONS.deployment.read],
        extraPermissions: [PERMISSIONS.deployment.export],
      }),
    )

    // Comes back, because QA grants it.
    expect(after.revokedPermissions).toEqual([])
    // Stays, because it was added by hand and no role decides it.
    expect(after.extraPermissions).toEqual([PERMISSIONS.deployment.export])
  })

  it('keeps a revocation the newly assigned role does not grant', async () => {
    const viewerRoleId = (
      await db.role.findFirstOrThrow({ where: { organizationId, key: 'viewer', deletedAt: null } })
    ).id

    const user = await newUser({ roleIds: [engineerRoleId] })

    // Viewer grants neither, so both revocations are unrelated to the change.
    const after = await usersService.updateUser(
      adminCtx,
      user.id,
      update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [viewerRoleId],
        revokedPermissions: [PERMISSIONS.deployment.rollback],
      }),
    )

    expect(after.revokedPermissions).toEqual([PERMISSIONS.deployment.rollback])
  })

  it('revokes live sessions when only the permissions change', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    await usersService.updateUser(
      adminCtx,
      user.id,
      update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [engineerRoleId],
        extraPermissions: [PERMISSIONS.deployment.rollback],
      }),
    )

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    /// Same reasoning as a role change: the epoch is what makes it immediate.
    expect(after.sessionEpoch).toBe(user.sessionEpoch + 1)
  })

  it('records its own audit action, not a generic update', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    await usersService.updateUser(
      adminCtx,
      user.id,
      update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [engineerRoleId],
        extraPermissions: [PERMISSIONS.deployment.rollback],
      }),
    )

    const entry = await db.auditLog.findFirst({
      where: { action: 'user.permissions_changed', targetUserId: user.id },
    })

    // The line someone reads the audit log to find after an incident.
    expect(entry).not.toBeNull()
    expect(entry?.metadata).toMatchObject({ added: [PERMISSIONS.deployment.rollback] })
  })
})

describe('audit', () => {
  it('records a role change as its own action', async () => {
    const user = await newUser()

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Managed Account',
      status: 'ACTIVE',
      roleIds: [engineerRoleId],
    }))

    const entry = await db.auditLog.findFirst({
      where: { action: 'user.role_changed', targetUserId: user.id },
    })
    expect(entry).not.toBeNull()
    expect(entry?.summary).toContain('Engineer')
  })

  it('records a suspension separately from a plain update', async () => {
    const user = await newUser()

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Managed Account',
      status: 'SUSPENDED',
      roleIds: [],
    }))

    const suspended = await db.auditLog.findFirst({
      where: { action: 'user.suspended', targetUserId: user.id },
    })
    expect(suspended).not.toBeNull()
    expect(suspended?.metadata).toMatchObject({ from: 'ACTIVE', to: 'SUSPENDED' })

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Managed Account',
      status: 'ACTIVE',
      roleIds: [],
    }))

    const reactivated = await db.auditLog.findFirst({
      where: { action: 'user.reactivated', targetUserId: user.id },
    })
    expect(reactivated).not.toBeNull()
  })

  it('records a bare rename as user.updated', async () => {
    const user = await newUser()

    await usersService.updateUser(adminCtx, user.id, update({
      name: 'Just A Rename',
      status: 'ACTIVE',
      roleIds: [],
    }))

    const entry = await db.auditLog.findFirst({
      where: { action: 'user.updated', targetUserId: user.id },
    })
    expect(entry).not.toBeNull()
  })
})

describe('the last administrator cannot be locked out', () => {
  /**
   * The seeded admin is the only super admin on a fresh install, so it stands in
   * for "the last one" without the test having to remove anyone.
   */
  it('refuses to strip the only super admin of their role', async () => {
    const others = await db.user.count({
      where: {
        organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        roleIds: { has: superRoleId },
        id: { not: adminCtx.actorId },
      },
    })

    // Only meaningful while the seeded admin really is alone.
    if (others > 0) return

    await expect(
      usersService.updateUser(adminCtx, adminCtx.actorId, update({
        name: 'Platform Admin',
        status: 'ACTIVE',
        roleIds: [engineerRoleId],
      })),
    ).rejects.toThrow(/last administrator/i)

    await expect(
      usersService.updateUser(adminCtx, adminCtx.actorId, update({
        name: 'Platform Admin',
        status: 'SUSPENDED',
        roleIds: [superRoleId],
      })),
    ).rejects.toThrow(/last administrator/i)
  })

  it('allows it once a second administrator exists', async () => {
    const backup = await newUser({ roleIds: [superRoleId] })

    const target = await newUser({ roleIds: [superRoleId] })

    // Two super admins now, so demoting one is safe and must be permitted.
    const updated = await usersService.updateUser(adminCtx, target.id, update({
      name: 'Managed Account',
      status: 'ACTIVE',
      roleIds: [engineerRoleId],
    }))

    expect(updated.roleIds).toEqual([engineerRoleId])
    expect(backup.id).toBeTruthy()
  })

  it('does not count a suspended administrator as cover', async () => {
    const suspendedAdmin = await newUser({ status: 'SUSPENDED', roleIds: [superRoleId] })
    const target = await newUser({ roleIds: [superRoleId] })

    const activeElsewhere = await db.user.count({
      where: {
        organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        roleIds: { has: superRoleId },
        id: { notIn: [target.id, suspendedAdmin.id] },
      },
    })

    if (activeElsewhere > 0) return

    // A suspended account cannot sign in, so it is not a way back in.
    await expect(
      usersService.updateUser(adminCtx, target.id, update({
        name: 'Managed Account',
        status: 'ACTIVE',
        roleIds: [],
      })),
    ).rejects.toThrow(/last administrator/i)
  })
})

describe('deleting', () => {
  it('refuses to delete your own account', async () => {
    await expect(usersService.deleteUser(adminCtx, adminCtx.actorId)).rejects.toThrow(
      /your own account/i,
    )
  })

  it('refuses to delete the last administrator', async () => {
    const target = await newUser({ roleIds: [superRoleId] })

    const activeElsewhere = await db.user.count({
      where: {
        organizationId,
        deletedAt: null,
        status: 'ACTIVE',
        roleIds: { has: superRoleId },
        id: { not: target.id },
      },
    })

    if (activeElsewhere > 0) return

    await expect(usersService.deleteUser(adminCtx, target.id)).rejects.toThrow(
      /last administrator/i,
    )
  })

  it('soft-deletes an ordinary account and revokes its sessions', async () => {
    const user = await newUser({ roleIds: [engineerRoleId] })

    await usersService.deleteUser(adminCtx, user.id)

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(after.deletedAt).not.toBeNull()
    expect(after.status).toBe('DEACTIVATED')
    expect(after.sessionEpoch).toBe(user.sessionEpoch + 1)
  })
})

describe('permissions', () => {
  it('refuses a suspension to an actor without user.suspend', async () => {
    const user = await newUser()

    /// Holds user.edit but not user.suspend: renaming and blocking sign-in are
    /// different authorities and the catalog has always split them.
    const editorCtx: RequestContext = {
      ...adminCtx,
      roleKeys: ['editor-only'],
      permissions: {
        global: new Set(['user.read', 'user.edit']),
        byProject: new Map(),
        isSuperAdmin: false,
      },
    }

    // A rename is fine...
    await expect(
      usersService.updateUser(editorCtx, user.id, update({
        name: 'Renamed By Editor',
        status: 'ACTIVE',
        roleIds: [],
      })),
    ).resolves.toBeTruthy()

    // ...changing the status is not.
    await expect(
      usersService.updateUser(editorCtx, user.id, update({
        name: 'Renamed By Editor',
        status: 'SUSPENDED',
        roleIds: [],
      })),
    ).rejects.toThrow()
  })

  it('refuses the whole user list to an actor without user.read', async () => {
    const nobodyCtx: RequestContext = {
      ...adminCtx,
      roleKeys: ['nobody'],
      permissions: { global: new Set(), byProject: new Map(), isSuperAdmin: false },
    }

    await expect(usersService.listUsers(nobodyCtx)).rejects.toThrow()
  })

  /**
   * Privilege-escalation guard on the edit door. `user.edit` must not be a path
   * to granting authority the actor does not hold — via a role or directly.
   */
  it('refuses to grant a role whose permissions the actor does not hold', async () => {
    const user = await newUser()

    // Holds user.edit but nothing like the super-admin/Admin bundle.
    const editorCtx: RequestContext = {
      ...adminCtx,
      roleKeys: ['editor-only'],
      permissions: {
        global: new Set(['user.read', 'user.edit']),
        byProject: new Map(),
        isSuperAdmin: false,
      },
    }

    await expect(
      usersService.updateUser(
        editorCtx,
        user.id,
        update({ name: 'Escalation Attempt', status: 'ACTIVE', roleIds: [superRoleId] }),
      ),
    ).rejects.toThrow(/permissions you do not hold/i)
  })

  it('refuses to add an extra permission the actor does not hold', async () => {
    const user = await newUser()

    const editorCtx: RequestContext = {
      ...adminCtx,
      roleKeys: ['editor-only'],
      permissions: {
        global: new Set(['user.read', 'user.edit']),
        byProject: new Map(),
        isSuperAdmin: false,
      },
    }

    await expect(
      usersService.updateUser(
        editorCtx,
        user.id,
        update({
          name: 'Escalation Attempt',
          status: 'ACTIVE',
          roleIds: [],
          extraPermissions: [PERMISSIONS.settings.manage],
        }),
      ),
    ).rejects.toThrow(/permissions you do not hold/i)
  })

  it('lets an actor grant only what they themselves hold', async () => {
    const user = await newUser()

    // This actor holds exactly the permissions Engineer grants, so assigning
    // Engineer is within their authority and must be allowed.
    const engineer = SEED_ROLES.find((r) => r.key === 'engineer')!
    const capableCtx: RequestContext = {
      ...adminCtx,
      roleKeys: ['capable'],
      permissions: {
        global: new Set<string>(['user.read', 'user.edit', ...engineer.permissions]),
        byProject: new Map(),
        isSuperAdmin: false,
      },
    }

    const updated = await usersService.updateUser(
      capableCtx,
      user.id,
      update({ name: 'Within Authority', status: 'ACTIVE', roleIds: [engineerRoleId] }),
    )
    expect(updated.roleIds).toEqual([engineerRoleId])
  })
})

describe('invitations from a user row', () => {
  it('reports clearly when there is no pending invitation', async () => {
    const user = await newUser()

    // Resend and revoke are keyed on the invitation; an accepted account has none.
    await expect(usersService.resendInvitation(adminCtx, user.id)).rejects.toThrow(
      /no pending invitation/i,
    )
    await expect(usersService.revokeInvitation(adminCtx, user.id)).rejects.toThrow(
      /no pending invitation/i,
    )
  })

  it('withdraws a pending invitation and removes the placeholder account', async () => {
    const email = `invite-revoke-${Date.now()}@example.com`

    const invited = await usersService.inviteUser(adminCtx, {
      email,
      name: 'Pending Person',
      roleIds: [engineerRoleId],
    })
    createdUserIds.push(invited.userId)
    createdInvitationIds.push(invited.invitation.id)

    const before = await db.user.findUniqueOrThrow({ where: { id: invited.userId } })
    expect(before.status).toBe('INVITED')

    await usersService.revokeInvitation(adminCtx, invited.userId)

    const invitation = await db.invitation.findUniqueOrThrow({
      where: { id: invited.invitation.id },
    })
    expect(invitation.status).toBe('REVOKED')

    /// The placeholder goes too — an orphaned INVITED row makes the user list
    /// claim someone has access when they never will.
    const after = await db.user.findUniqueOrThrow({ where: { id: invited.userId } })
    expect(after.deletedAt).not.toBeNull()
  })
})
