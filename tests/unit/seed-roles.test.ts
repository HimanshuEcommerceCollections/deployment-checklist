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

/** Build a context holding exactly one seeded role, org-wide. */
function ctxForRole(key: string): RequestContext {
  const role = SEED_ROLES.find((r) => r.key === key)
  if (!role) throw new Error(`No seeded role "${key}"`)

  const permissions = resolvePermissions({
    globalRoleIds: ['r'],
    memberships: [],
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
  it('defines exactly the five documented roles', () => {
    expect(SEED_ROLES.map((r) => r.key)).toEqual([
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
      if (role.key === 'admin') {
        expect(wildcards).toEqual([WILDCARD])
      } else {
        expect(wildcards, `${role.key} must list permissions explicitly`).toEqual([])
      }
    }
  })

  it('has exactly one super-admin and one default role', () => {
    const superAdmins = SEED_ROLES.filter((r) => 'isSuperAdmin' in r && r.isSuperAdmin)
    const defaults = SEED_ROLES.filter((r) => 'isDefault' in r && r.isDefault)

    expect(superAdmins.map((r) => r.key)).toEqual(['admin'])
    expect(defaults.map((r) => r.key)).toEqual(['engineer'])
  })
})

describe('role capabilities', () => {
  it('lets everyone but Viewer tick checklist items', () => {
    for (const key of ['admin', 'release-manager', 'engineer', 'qa']) {
      expect(can(ctxForRole(key), PERMISSIONS.deployment.execute), key).toBe(true)
    }
    expect(can(ctxForRole('viewer'), PERMISSIONS.deployment.execute)).toBe(false)
  })

  it('gives Viewer nothing that changes state', () => {
    const ctx = ctxForRole('viewer')

    expect(can(ctx, PERMISSIONS.project.read)).toBe(true)
    expect(can(ctx, PERMISSIONS.deployment.read)).toBe(true)

    for (const permission of [
      PERMISSIONS.deployment.execute,
      PERMISSIONS.deployment.create,
      PERMISSIONS.deployment.complete,
      PERMISSIONS.comment.create,
      PERMISSIONS.template.manage,
    ]) {
      expect(can(ctx, permission), permission).toBe(false)
    }
  })

  it('blocks Engineer and QA from production entirely', () => {
    // `isProductionEnvironment` adds deployment.production as an implicit
    // requirement, so lacking it denies EVERY action on a production run — not
    // just creating one.
    for (const key of ['engineer', 'qa', 'viewer']) {
      const ctx = ctxForRole(key)
      expect(can(ctx, PERMISSIONS.deployment.production), key).toBe(false)
      expect(
        can(ctx, PERMISSIONS.deployment.execute, { isProductionEnvironment: true }),
        `${key} must not act on a production run`,
      ).toBe(false)
    }
  })

  it('lets Release Manager act on production', () => {
    const ctx = ctxForRole('release-manager')
    expect(can(ctx, PERMISSIONS.deployment.execute, { isProductionEnvironment: true })).toBe(true)
    expect(can(ctx, PERMISSIONS.deployment.complete, { isProductionEnvironment: true })).toBe(true)
  })

  it('keeps organisation administration out of Release Manager', () => {
    const ctx = ctxForRole('release-manager')

    // It ships software; it does not administer the organisation.
    for (const permission of [
      PERMISSIONS.role.manage,
      PERMISSIONS.user.invite,
      PERMISSIONS.settings.manage,
      PERMISSIONS.project.delete,
    ]) {
      expect(can(ctx, permission), permission).toBe(false)
    }

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

describe('org-wide visibility (docs/14 §14.2)', () => {
  /**
   * The regression this guards: project visibility used to come from a
   * `memberships: { some: { userId } }` filter in each service, which ignored
   * permissions entirely. A global role therefore granted permission but no
   * visibility, and a fresh install showed nobody any project — including the
   * super-admin, because a raw Prisma filter cannot honour `can()`'s
   * short-circuit.
   */
  it('gives every seeded role with project.read an unfiltered project query', () => {
    for (const key of ['admin', 'release-manager', 'engineer', 'qa', 'viewer']) {
      expect(projectFilter(ctxForRole(key), PERMISSIONS.project.read, 'id'), key).toEqual({})
    }
  })

  it('still matches no rows for an actor with no grants', () => {
    const ctx: RequestContext = {
      ...ctxForRole('viewer'),
      permissions: { global: new Set(), byProject: new Map(), isSuperAdmin: false },
    }

    // `{ in: [] }`, never `{}` — an unfiltered query here would expose every row.
    expect(projectFilter(ctx, PERMISSIONS.project.read, 'id')).toEqual({ id: { in: [] } })
  })
})
