import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { membersService } from '@/features/projects/server/members-service'
import { projectsService } from '@/features/projects/server/projects-service'
import { allDeploymentsService } from '@/features/deployments/server/all-deployments-service'
import { deploymentsService } from '@/features/deployments/server/deployments-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { resolvePermissions } from '@/lib/authz/authorize'
import { PERMISSIONS, WILDCARD } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * Project assignment as the access mechanism.
 *
 * The authorization layer already narrowed reads through `projectFilter`; what was
 * missing was any way to create the grants and any test that the narrowing is real.
 * These build contexts the way `getRequestContext` does — through
 * `resolvePermissions` over real roles and real Membership rows — so a regression
 * in either the resolver or the filter fails here rather than in production.
 *
 * Requires a seeded database.
 */
let organizationId: string
let adminId: string
let engineerRoleId: string
let orgOnlyRoleId: string
let projectA: { id: string; name: string }
let projectB: { id: string; name: string }
let adminCtx: RequestContext

const createdUserIds: string[] = []
const createdRoleIds: string[] = []

/** A context assembled exactly as the request pipeline assembles one. */
async function ctxForUser(userId: string): Promise<RequestContext> {
  const user = await db.user.findFirstOrThrow({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      roleIds: true,
      memberships: { where: { deletedAt: null }, select: { projectId: true } },
    },
  })

  const roles = await db.role.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, key: true, permissions: true, isSuperAdmin: true },
  })

  return {
    actorId: user.id,
    actorType: 'user',
    actorEmail: user.email,
    actorName: user.name,
    organizationId,
    roleKeys: [],
    permissions: resolvePermissions({
      roleIds: user.roleIds,
      assignedProjectIds: user.memberships.map((m) => m.projectId),
      rolesById: new Map(roles.map((r) => [r.id, r])),
    }),
    requestId: `test-${user.id}`,
    timezone: 'UTC',
  }
}

async function newUser(roleIds: string[] = []) {
  const user = await db.user.create({
    data: {
      organizationId,
      email: `project-access-${createdUserIds.length}-${Date.now()}@example.com`,
      name: 'Scoped Person',
      status: 'ACTIVE',
      roleIds,
    },
  })
  createdUserIds.push(user.id)
  return user
}

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ where: { slug: 'default' } })
  organizationId = organization.id

  const admin = await db.user.findFirstOrThrow({
    where: { organizationId, email: 'admin@example.com', deletedAt: null },
  })
  adminId = admin.id
  adminCtx = await ctxForUser(admin.id)

  engineerRoleId = (
    await db.role.findFirstOrThrow({ where: { organizationId, key: 'engineer', deletedAt: null } })
  ).id

  const projects = await db.project.findMany({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    take: 2,
    select: { id: true, name: true },
  })
  if (projects.length < 2) throw new Error('this suite needs at least two seeded projects')
  projectA = projects[0]!
  projectB = projects[1]!

  const orgOnly = await db.role.create({
    data: {
      organizationId,
      key: `org-only-${Date.now()}`,
      name: 'Org Only Tester',
      permissions: [PERMISSIONS.project.read],
      isAssignableGlobally: true,
      isAssignableOnProject: false,
    },
  })
  createdRoleIds.push(orgOnly.id)
  orgOnlyRoleId = orgOnly.id
})

afterAll(async () => {
  await db.membership.deleteMany({ where: { userId: { in: createdUserIds } } })
  await db.user.deleteMany({ where: { id: { in: createdUserIds } } })
  await db.role.deleteMany({ where: { id: { in: createdRoleIds } } })
})

describe('a user with no grants', () => {
  it('sees no projects rather than all of them', async () => {
    const user = await newUser()
    const ctx = await ctxForUser(user.id)

    // The classic broken-authorization bug is an unfiltered query here.
    await expect(projectsService.listUserProjects(ctx)).rejects.toThrow()
  })

  it('cannot open a project by id', async () => {
    const user = await newUser()
    const ctx = await ctxForUser(user.id)

    await expect(projectsService.getProject(ctx, projectA.id)).rejects.toThrow()
  })
})

describe('a user assigned to one project', () => {
  it('sees that project and no other', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    const ctx = await ctxForUser(user.id)
    const visible = await projectsService.listUserProjects(ctx)

    expect(visible.map((p) => p.id)).toEqual([projectA.id])
  })

  it('is refused the project they were not assigned', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    const ctx = await ctxForUser(user.id)

    await expect(projectsService.getProject(ctx, projectA.id)).resolves.toBeTruthy()
    await expect(projectsService.getProject(ctx, projectB.id)).rejects.toThrow()
  })

  it('is refused another project’s deployments', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    const ctx = await ctxForUser(user.id)

    await expect(deploymentsService.listProjectDeployments(ctx, projectA.id)).resolves.toBeDefined()
    /// Refused rather than an empty list: the caller named a project they hold no
    /// permission on, which is the same answer getProject gives.
    await expect(deploymentsService.listProjectDeployments(ctx, projectB.id)).rejects.toThrow()
  })

  it('sees only its own runs in the cross-project deployment list', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    const ctx = await ctxForUser(user.id)
    const visible = await allDeploymentsService.listUserDeployments(ctx)

    // The filter applied to a different collection — a list that forgot
    // projectFilter would leak here and not in the projects list.
    expect(visible.every((run) => run.projectId === projectA.id)).toBe(true)
  })

  it('loses it again when the grant is revoked', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    expect((await projectsService.listUserProjects(await ctxForUser(user.id))).length).toBe(1)

    await membersService.revokeProject(adminCtx, projectA.id, user.id)

    /// Permissions resolve per request from Membership, so this takes effect on the
    /// next context — no session bump and no re-login.
    await expect(projectsService.listUserProjects(await ctxForUser(user.id))).rejects.toThrow()
  })

  it('gains a second project without losing the first', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)
    await membersService.assignProject(adminCtx, projectB.id, user.id)

    const visible = await projectsService.listUserProjects(await ctxForUser(user.id))
    expect(visible.map((p) => p.id).sort()).toEqual([projectA.id, projectB.id].sort())
  })
})

describe('an ordinary role can no longer escape assignment', () => {
  /**
   * This describe used to assert the opposite — that a role carrying `project.read`
   * showed every project regardless of assignment. That was true while roles were
   * granted organization-wide, and it is exactly what made assignment decoration.
   *
   * `resolvePermissions` now places project-scoped permissions on assigned projects
   * only, so the escape hatch is closed for every role except the wildcard.
   */
  it('sees only its assigned projects even holding a project.read role', async () => {
    const user = await newUser([orgOnlyRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    const ctx = await ctxForUser(user.id)
    const visible = await projectsService.listUserProjects(ctx)

    const total = await db.project.count({ where: { organizationId, deletedAt: null } })
    expect(total).toBeGreaterThan(1)
    expect(visible.map((p) => p.id)).toEqual([projectA.id])
  })
})

describe('roles come from the user, not the assignment', () => {
  it('grants nothing to a user assigned to a project but holding no roles', async () => {
    const user = await newUser()
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    const ctx = await ctxForUser(user.id)

    /// The distinction the model rests on. Assignment says WHERE a user's roles
    /// apply; with no roles there is nothing to apply, so access is still nil.
    expect(ctx.permissions.byProject.get(projectA.id)?.size ?? 0).toBe(0)
    await expect(projectsService.listUserProjects(ctx)).rejects.toThrow()
  })

  it('applies the same roles to every project the user is assigned to', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)
    await membersService.assignProject(adminCtx, projectB.id, user.id)

    const ctx = await ctxForUser(user.id)

    // One role set, two places. There is no longer a way to be Engineer on one and
    // something else on the other.
    for (const id of [projectA.id, projectB.id]) {
      expect(ctx.permissions.byProject.get(id)?.has(PERMISSIONS.deployment.execute)).toBe(true)
    }
  })

  it('keeps organization-scoped permissions global while project ones stay scoped', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    const ctx = await ctxForUser(user.id)

    // Templates are organization-wide, so Engineer reads them anywhere...
    expect(ctx.permissions.global.has(PERMISSIONS.template.read)).toBe(true)
    // ...while deployment authority is confined to the assigned project.
    expect(ctx.permissions.global.has(PERMISSIONS.deployment.read)).toBe(false)
    expect(ctx.permissions.byProject.get(projectA.id)?.has(PERMISSIONS.deployment.read)).toBe(true)
  })

  it('changing the user’s roles changes what they can do everywhere at once', async () => {
    const viewerRoleId = (
      await db.role.findFirstOrThrow({ where: { organizationId, key: 'viewer', deletedAt: null } })
    ).id

    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    expect(
      (await ctxForUser(user.id)).permissions.byProject
        .get(projectA.id)
        ?.has(PERMISSIONS.deployment.execute),
    ).toBe(true)

    await db.user.update({ where: { id: user.id }, data: { roleIds: [viewerRoleId] } })

    const after = await ctxForUser(user.id)
    expect(after.permissions.byProject.get(projectA.id)?.has(PERMISSIONS.deployment.execute)).toBe(
      false,
    )
    // Still assigned, still sees it — just cannot act on it.
    expect(after.permissions.byProject.get(projectA.id)?.has(PERMISSIONS.project.read)).toBe(true)
  })
})

describe('assignment is idempotent', () => {
  it('assigning twice leaves one row and does not fail', async () => {
    const user = await newUser([engineerRoleId])

    const first = await membersService.assignProject(adminCtx, projectA.id, user.id)
    const second = await membersService.assignProject(adminCtx, projectA.id, user.id)

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)

    const rows = await db.membership.count({
      where: { userId: user.id, projectId: projectA.id, deletedAt: null },
    })
    expect(rows).toBe(1)
  })

  it('re-assigning after a revoke revives the row rather than colliding', async () => {
    const user = await newUser([engineerRoleId])

    await membersService.assignProject(adminCtx, projectA.id, user.id)
    await membersService.revokeProject(adminCtx, projectA.id, user.id)
    await membersService.assignProject(adminCtx, projectA.id, user.id)

    /// `@@unique([userId, projectId])` ignores deletedAt, so a second insert would
    /// hit the index — the revive is what keeps this working.
    const rows = await db.membership.count({
      where: { userId: user.id, projectId: projectA.id, deletedAt: null },
    })
    expect(rows).toBe(1)

    const visible = await projectsService.listUserProjects(await ctxForUser(user.id))
    expect(visible.map((p) => p.id)).toEqual([projectA.id])
  })

  it('refuses to revoke someone who was never assigned', async () => {
    const user = await newUser([engineerRoleId])

    await expect(membersService.revokeProject(adminCtx, projectA.id, user.id)).rejects.toThrow(
      /not assigned/i,
    )
  })
})

describe('the user-first view of assignments', () => {
  it('lists every project a user is assigned to', async () => {
    const user = await newUser([engineerRoleId])
    await membersService.assignProject(adminCtx, projectA.id, user.id)
    await membersService.assignProject(adminCtx, projectB.id, user.id)

    const assigned = await membersService.listUserProjects(adminCtx, user.id)

    expect(assigned).toHaveLength(2)
    expect(assigned.map((g) => g.project.id).sort()).toEqual([projectA.id, projectB.id].sort())
  })

  it('hides grants pointing at a deleted project', async () => {
    const project = await db.project.create({
      data: {
        organizationId,
        name: `Access Temp ${Date.now()}`,
        key: `ATMP${Date.now() % 10000}`,
        slug: `access-temp-${Date.now()}`,
        createdById: adminId,
      },
    })

    const user = await newUser()
    await membersService.assignProject(adminCtx, project.id, user.id)

    expect(await membersService.listUserProjects(adminCtx, user.id)).toHaveLength(1)

    await db.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } })

    try {
      /// The membership row survives a soft delete, and offering access to
      /// something no read can reach would be a dead end in the UI.
      expect(await membersService.listUserProjects(adminCtx, user.id)).toHaveLength(0)
    } finally {
      await db.membership.deleteMany({ where: { projectId: project.id } })
      await db.project.deleteMany({ where: { id: project.id } })
    }
  })
})

describe('superadmin', () => {
  it('sees everything without any membership', async () => {
    const superRole = await db.role.findFirstOrThrow({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ isSuperAdmin: true }, { permissions: { has: WILDCARD } }],
      },
    })

    const user = await newUser([superRole.id])
    const ctx = await ctxForUser(user.id)

    const visible = await projectsService.listUserProjects(ctx)
    const total = await db.project.count({ where: { organizationId, deletedAt: null } })

    expect(visible.length).toBe(total)
  })
})
