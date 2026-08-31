import { describe, expect, it } from 'vitest'

import {
  type RequestContext,
  can,
  projectFilter,
  resolvePermissions,
} from '@/lib/authz/authorize'
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  SEED_ROLES,
  WILDCARD,
} from '@/lib/authz/permissions'

/**
 * The seeded role set is a design decision, so it gets tests.
 *
 * These are the guarantees the roles exist to provide (docs/14 §14.3). Each one
 * is quiet to break by editing a permission list — a role that silently gains
 * production access looks like a one-line diff.
 */

/** The project every context below is assigned to. */
const PROJECT = 'p1'

/**
 * Build a context holding exactly one seeded role, assigned to one project.
 *
 * The assignment is not incidental. Roles live on the user and their
 * project-scoped permissions apply only where the user is assigned, so a context
 * with no assignments has no deployment or checklist authority anywhere — which
 * would make every capability assertion below vacuously false.
 */
function ctxForRole(key: string, assignedProjectIds: string[] = [PROJECT]): RequestContext {
  const role = SEED_ROLES.find((r) => r.key === key)
  if (!role) throw new Error(`No seeded role "${key}"`)

  const permissions = resolvePermissions({
    roleIds: ['r'],
    assignedProjectIds,
    rolesById: new Map([
      [
        'r',
        {
          id: 'r',
          key: role.key,
          permissions: [...role.permissions],
          isSuperAdmin: 'isSuperAdmin' in role ? Boolean(role.isSuperAdmin) : false,
        },
      ],
    ]),
  })

  return {
    actorId: 'u1',
    actorType: 'user',
    actorEmail: 'u@example.com',
    actorName: 'U',
    organizationId: 'org1',
    roleKeys: [role.key],
    permissions,
    requestId: 'test',
    timezone: 'UTC',
  }
}

describe('seeded roles', () => {
  it('defines exactly the six documented roles', () => {
    expect(SEED_ROLES.map((r) => r.key)).toEqual([
      'super-admin',
      'admin',
      'release-manager',
      'engineer',
      'qa',
      'viewer',
    ])
  })

  it('grants only keys that exist in the catalog', () => {
    const catalog = new Set<string>(ALL_PERMISSION_KEYS)

    for (const role of SEED_ROLES) {
      for (const permission of role.permissions) {
        if (permission === WILDCARD) continue
        expect(catalog.has(permission), `${role.key} grants unknown "${permission}"`).toBe(true)
      }
    }
  })

  it('uses a wildcard for the super-admin and nowhere else', () => {
    // A wildcard role silently acquires every permission added to the catalog
    // later, so it stops meaning what it meant when someone approved it. The
    // bootstrap role is the one place that behaviour is wanted.
    for (const role of SEED_ROLES) {
      const wildcards = role.permissions.filter((p) => p === WILDCARD || p.endsWith('.*'))
      if (role.key === 'super-admin') {
        expect(wildcards).toEqual([WILDCARD])
      } else {
        expect(wildcards, `${role.key} must list permissions explicitly`).toEqual([])
      }
    }
  })

  it('has exactly one super-admin and one default role', () => {
    const superAdmins = SEED_ROLES.filter((r) => 'isSuperAdmin' in r && r.isSuperAdmin)
    const defaults = SEED_ROLES.filter((r) => 'isDefault' in r && r.isDefault)

    expect(superAdmins.map((r) => r.key)).toEqual(['super-admin'])
    expect(defaults.map((r) => r.key)).toEqual(['engineer'])
  })

  it('grants Admin everything in the catalog except users and roles', () => {
    const admin = SEED_ROLES.find((r) => r.key === 'admin')!
    const granted = new Set<string>(admin.permissions)

    for (const key of ALL_PERMISSION_KEYS) {
      const isUserManagement = key.startsWith('user.') || key.startsWith('role.')
      expect(granted.has(key), `admin ${isUserManagement ? 'must not grant' : 'must grant'} ${key}`).toBe(
        !isUserManagement,
      )
    }
  })
})

describe('role capabilities', () => {
  it('lets everyone but Viewer tick checklist items', () => {
    for (const key of ['super-admin', 'admin', 'release-manager', 'engineer', 'qa']) {
      expect(can(ctxForRole(key), PERMISSIONS.deployment.execute, { projectId: PROJECT }), key).toBe(
        true,
      )
    }
    expect(
      can(ctxForRole('viewer'), PERMISSIONS.deployment.execute, { projectId: PROJECT }),
    ).toBe(false)
  })

  it('gives Viewer nothing that changes state', () => {
    const ctx = ctxForRole('viewer')

    expect(can(ctx, PERMISSIONS.project.read, { projectId: PROJECT })).toBe(true)
    expect(can(ctx, PERMISSIONS.deployment.read, { projectId: PROJECT })).toBe(true)

    for (const permission of [
      PERMISSIONS.deployment.execute,
      PERMISSIONS.deployment.create,
      PERMISSIONS.deployment.complete,
      PERMISSIONS.comment.create,
    ]) {
      expect(can(ctx, permission, { projectId: PROJECT }), permission).toBe(false)
    }

    // Organization-scoped, so it needs no project scope to be denied.
    expect(can(ctx, PERMISSIONS.template.manage)).toBe(false)
  })

  it('blocks Engineer and QA from production entirely', () => {
    // `isProductionEnvironment` adds deployment.production as an implicit
    // requirement, so lacking it denies EVERY action on a production run — not
    // just creating one.
    for (const key of ['engineer', 'qa', 'viewer']) {
      const ctx = ctxForRole(key)
      expect(can(ctx, PERMISSIONS.deployment.production, { projectId: PROJECT }), key).toBe(false)
      expect(
        can(ctx, PERMISSIONS.deployment.execute, {
          projectId: PROJECT,
          isProductionEnvironment: true,
        }),
        `${key} must not act on a production run`,
      ).toBe(false)
    }
  })

  it('lets Release Manager act on production', () => {
    const ctx = ctxForRole('release-manager')
    expect(
      can(ctx, PERMISSIONS.deployment.execute, {
        projectId: PROJECT,
        isProductionEnvironment: true,
      }),
    ).toBe(true)
    expect(
      can(ctx, PERMISSIONS.deployment.complete, {
        projectId: PROJECT,
        isProductionEnvironment: true,
      }),
    ).toBe(true)
  })

  it('keeps user management out of Admin', () => {
    const ctx = ctxForRole('admin')

    // The one thing separating Admin from Super Admin.
    for (const permission of [
      PERMISSIONS.user.read,
      PERMISSIONS.user.invite,
      PERMISSIONS.user.edit,
      PERMISSIONS.user.suspend,
      PERMISSIONS.role.read,
      PERMISSIONS.role.manage,
    ]) {
      expect(can(ctx, permission), permission).toBe(false)
    }

    // Everything else administrative stays.
    expect(can(ctx, PERMISSIONS.admin.access)).toBe(true)
    expect(can(ctx, PERMISSIONS.settings.manage)).toBe(true)
    expect(can(ctx, PERMISSIONS.template.publish)).toBe(true)
    expect(can(ctx, PERMISSIONS.environment.manage)).toBe(true)

    // No wildcard, so project visibility still comes from assignment.
    expect(projectFilter(ctxForRole('admin', []), PERMISSIONS.project.read, 'id')).toEqual({
      id: { in: [] },
    })
  })

  it('keeps organisation administration out of Release Manager', () => {
    const ctx = ctxForRole('release-manager')

    // It ships software; it does not administer the organisation.
    for (const permission of [
      PERMISSIONS.role.manage,
      PERMISSIONS.user.invite,
      PERMISSIONS.settings.manage,
    ]) {
      expect(can(ctx, permission), permission).toBe(false)
    }

    // Project-scoped, so checked where they actually work.
    expect(can(ctx, PERMISSIONS.project.delete, { projectId: PROJECT })).toBe(false)

    // But it must reach /admin/templates, which every admin page gates on.
    expect(can(ctx, PERMISSIONS.admin.access)).toBe(true)
    expect(can(ctx, PERMISSIONS.template.publish)).toBe(true)
  })

  it('keeps template editing away from Engineer and QA', () => {
    for (const key of ['engineer', 'qa']) {
      expect(can(ctxForRole(key), PERMISSIONS.template.manage), key).toBe(false)
      expect(can(ctxForRole(key), PERMISSIONS.template.read), key).toBe(true)
    }
  })
})

describe('project visibility (docs/14 §14.7)', () => {
  /**
   * Two regressions are guarded here, from opposite directions.
   *
   * The first: visibility used to come from a `memberships: { some: { userId } }`
   * filter in each service, which ignored permissions entirely — so a role granted
   * permission but no visibility, and a fresh install showed nobody any project,
   * including the super-admin, because a raw Prisma filter cannot honour `can()`'s
   * short-circuit.
   *
   * The second, introduced when that was fixed by making roles organization-wide:
   * every role carrying `project.read` then produced an UNFILTERED query, so
   * assignment could not restrict anyone. §14.2 asserted that as correct; it is
   * what §14.7 reversed.
   */
  it('narrows an ordinary role to the projects it is assigned to', () => {
    for (const key of ['release-manager', 'engineer', 'qa', 'viewer']) {
      expect(projectFilter(ctxForRole(key), PERMISSIONS.project.read, 'id'), key).toEqual({
        id: { in: [PROJECT] },
      })
    }
  })

  it('leaves the super-admin unfiltered without any assignment', () => {
    // The wildcard is organization-scoped and `can()` short-circuits on it, so the
    // bootstrap administrator never needs assigning to see the organization.
    expect(projectFilter(ctxForRole('super-admin', []), PERMISSIONS.project.read, 'id')).toEqual({})
  })

  it('matches no rows for a role with no assignment', () => {
    // Holding Engineer but assigned to nothing is a real state — it means "can act
    // on projects, has none". It must not become "can act on all of them".
    expect(projectFilter(ctxForRole('engineer', []), PERMISSIONS.project.read, 'id')).toEqual({
      id: { in: [] },
    })
  })

  it('still matches no rows for an actor with no grants at all', () => {
    const ctx: RequestContext = {
      ...ctxForRole('viewer'),
      permissions: { global: new Set(), byProject: new Map(), isSuperAdmin: false },
    }

    // `{ in: [] }`, never `{}` — an unfiltered query here would expose every row.
    expect(projectFilter(ctx, PERMISSIONS.project.read, 'id')).toEqual({ id: { in: [] } })
  })
})
