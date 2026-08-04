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
      memberships: { where: { deletedAt: null }, select: { projectId: true, roleId: true } },
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
      globalRoleIds: user.roleIds,
      memberships: user.memberships,
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
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    const ctx = await ctxForUser(user.id)
    const visible = await projectsService.listUserProjects(ctx)

    expect(visible.map((p) => p.id)).toEqual([projectA.id])
  })

  it('is refused the project they were not assigned', async () => {
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    const ctx = await ctxForUser(user.id)

    await expect(projectsService.getProject(ctx, projectA.id)).resolves.toBeTruthy()
    await expect(projectsService.getProject(ctx, projectB.id)).rejects.toThrow()
  })

  it('is refused another project’s deployments', async () => {
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    const ctx = await ctxForUser(user.id)

    await expect(deploymentsService.listProjectDeployments(ctx, projectA.id)).resolves.toBeDefined()
    /// Refused rather than an empty list: the caller named a project they hold no
    /// permission on, which is the same answer getProject gives.
    await expect(deploymentsService.listProjectDeployments(ctx, projectB.id)).rejects.toThrow()
  })

  it('sees only its own runs in the cross-project deployment list', async () => {
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    const ctx = await ctxForUser(user.id)
    const visible = await allDeploymentsService.listUserDeployments(ctx)

    // The filter applied to a different collection — a list that forgot
    // projectFilter would leak here and not in the projects list.
    expect(visible.every((run) => run.projectId === projectA.id)).toBe(true)
  })

  it('loses it again when the grant is revoked', async () => {
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    expect((await projectsService.listUserProjects(await ctxForUser(user.id))).length).toBe(1)

    await membersService.removeMember(adminCtx, projectA.id, user.id)

    /// Permissions resolve per request from Membership, so this takes effect on the
    /// next context — no session bump and no re-login.
    await expect(projectsService.listUserProjects(await ctxForUser(user.id))).rejects.toThrow()
  })

  it('gains a second project without losing the first', async () => {
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })
    await membersService.addMember(adminCtx, projectB.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    const visible = await projectsService.listUserProjects(await ctxForUser(user.id))
    expect(visible.map((p) => p.id).sort()).toEqual([projectA.id, projectB.id].sort())
  })
})

describe('an organization-wide grant still wins', () => {
  it('shows every project regardless of assignment', async () => {
    // This is the trap the UI now warns about: assign one project to someone who
    // holds project.read org-wide and they still see all of them.
    const user = await newUser([orgOnlyRoleId])
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    const ctx = await ctxForUser(user.id)
    const visible = await projectsService.listUserProjects(ctx)

    const total = await db.project.count({ where: { organizationId, deletedAt: null } })
    expect(visible.length).toBe(total)
    expect(visible.length).toBeGreaterThan(1)
  })
})

describe('which roles may be granted on a project', () => {
  it('refuses a role flagged organization-wide only', async () => {
    const user = await newUser()

    // isAssignableOnProject has been in the schema since the beginning and nothing
    // read it. Granting an org-only role per project would be a way to hand out
    // org-wide authority one project at a time.
    await expect(
      membersService.addMember(adminCtx, projectA.id, {
        userId: user.id,
        roleIds: [orgOnlyRoleId],
      }),
    ).rejects.toThrow(/organization-wide/i)
  })

  it('refuses it on a role change too, not only on the initial grant', async () => {
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    await expect(
      membersService.updateMemberRoles(adminCtx, projectA.id, user.id, {
        roleIds: [orgOnlyRoleId],
      }),
    ).rejects.toThrow(/organization-wide/i)
  })

  it('omits org-only roles from the assignable list', async () => {
    const assignable = await membersService.listAssignableRoles(adminCtx)

    expect(assignable.map((r) => r.id)).not.toContain(orgOnlyRoleId)
    expect(assignable.map((r) => r.id)).toContain(engineerRoleId)
  })
})

describe('the user-first view of grants', () => {
  it('lists every project a user holds, with their roles on each', async () => {
    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })
    await membersService.addMember(adminCtx, projectB.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

    const granted = await membersService.listUserProjects(adminCtx, user.id)

    expect(granted).toHaveLength(2)
    expect(granted.map((g) => g.project.id).sort()).toEqual([projectA.id, projectB.id].sort())
    expect(granted[0]!.roles.map((r) => r.name)).toContain('Engineer')
  })

  it('collapses several roles on one project into a single entry', async () => {
    const qaRoleId = (
      await db.role.findFirstOrThrow({ where: { organizationId, key: 'qa', deletedAt: null } })
    ).id

    const user = await newUser()
    await membersService.addMember(adminCtx, projectA.id, {
      userId: user.id,
      roleIds: [engineerRoleId, qaRoleId],
    })

    const granted = await membersService.listUserProjects(adminCtx, user.id)

    // Membership is one row per (user, project, role); callers think in people.
    expect(granted).toHaveLength(1)
    expect(granted[0]!.roles).toHaveLength(2)
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
    await membersService.addMember(adminCtx, project.id, {
      userId: user.id,
      roleIds: [engineerRoleId],
    })

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
