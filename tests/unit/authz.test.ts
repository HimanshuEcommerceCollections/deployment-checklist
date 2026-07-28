import { describe, expect, it } from 'vitest'

import {
  type RequestContext,
  can,
  canOnAnyProject,
  projectFilter,
  projectScopeFor,
  requirePermission,
  resolvePermissions,
  satisfies,
  serializeAbilities,
} from '@/lib/authz/authorize'
import { PERMISSIONS, pruneUnknown } from '@/lib/authz/permissions'

/**
 * Authorization is the part of this system where a bug is a breach, so it gets
 * the heaviest coverage. All pure — no database, no HTTP.
 */

function contextWith(grants: {
  global?: string[]
  byProject?: Record<string, string[]>
  isSuperAdmin?: boolean
}): RequestContext {
  return {
    actorId: 'user-1',
    actorType: 'user',
    actorEmail: 'test@example.com',
    actorName: 'Test User',
    organizationId: 'org-1',
    roleKeys: [],
    permissions: {
      global: new Set(grants.global ?? []),
      byProject: new Map(
        Object.entries(grants.byProject ?? {}).map(([id, keys]) => [id, new Set(keys)]),
      ),
      isSuperAdmin: grants.isSuperAdmin ?? false,
    },
    requestId: 'req-1',
    timezone: 'UTC',
  }
}

describe('satisfies', () => {
  it('grants everything on the super wildcard', () => {
    expect(satisfies(new Set(['*']), 'settings.manage')).toBe(true)
    expect(satisfies(new Set(['*']), 'anything.at.all')).toBe(true)
  })

  it('matches an exact permission', () => {
    expect(satisfies(new Set(['deployment.create']), 'deployment.create')).toBe(true)
    expect(satisfies(new Set(['deployment.create']), 'deployment.complete')).toBe(false)
  })

  it('matches nested prefixes right to left', () => {
    expect(satisfies(new Set(['deployment.item.*']), 'deployment.item.skip')).toBe(true)
    expect(satisfies(new Set(['deployment.*']), 'deployment.item.skip')).toBe(true)
  })

  it('does not match across resources', () => {
    expect(satisfies(new Set(['deployment.*']), 'template.publish')).toBe(false)
  })

  it('has no suffix globs — they would be unreviewable in a role editor', () => {
    expect(satisfies(new Set(['*.create']), 'project.create')).toBe(false)
  })

  it('denies on an empty grant set', () => {
    expect(satisfies(new Set(), 'project.read')).toBe(false)
  })
})

describe('can', () => {
  it('allows a global grant on any project', () => {
    const ctx = contextWith({ global: [PERMISSIONS.deployment.read] })
    expect(can(ctx, PERMISSIONS.deployment.read, { projectId: 'anything' })).toBe(true)
  })

  it('scopes a project grant to that project only', () => {
    const ctx = contextWith({ byProject: { p1: [PERMISSIONS.deployment.execute] } })
    expect(can(ctx, PERMISSIONS.deployment.execute, { projectId: 'p1' })).toBe(true)
    expect(can(ctx, PERMISSIONS.deployment.execute, { projectId: 'p2' })).toBe(false)
    // Without a project scope there is nothing to match against.
    expect(can(ctx, PERMISSIONS.deployment.execute)).toBe(false)
  })

  it('unions global and project grants', () => {
    const ctx = contextWith({
      global: [PERMISSIONS.deployment.read],
      byProject: { p1: [PERMISSIONS.deployment.complete] },
    })
    expect(can(ctx, PERMISSIONS.deployment.read, { projectId: 'p1' })).toBe(true)
    expect(can(ctx, PERMISSIONS.deployment.complete, { projectId: 'p1' })).toBe(true)
    expect(can(ctx, PERMISSIONS.deployment.complete, { projectId: 'p2' })).toBe(false)
  })

  it('refuses a globalOnly permission granted via a project role', () => {
    // A misconfigured role must not make project membership a route to settings.
    const ctx = contextWith({ byProject: { p1: [PERMISSIONS.settings.manage] } })
    expect(can(ctx, PERMISSIONS.settings.manage, { projectId: 'p1' })).toBe(false)
  })

  it('requires deployment.production on a production environment', () => {
    const ctx = contextWith({ global: [PERMISSIONS.deployment.create] })
    expect(can(ctx, PERMISSIONS.deployment.create, { projectId: 'p1' })).toBe(true)
    expect(
      can(ctx, PERMISSIONS.deployment.create, { projectId: 'p1', isProductionEnvironment: true }),
    ).toBe(false)
  })

  it('allows production when both permissions are held', () => {
    const ctx = contextWith({
      global: [PERMISSIONS.deployment.create, PERMISSIONS.deployment.production],
    })
    expect(
      can(ctx, PERMISSIONS.deployment.create, { projectId: 'p1', isProductionEnvironment: true }),
    ).toBe(true)
  })

  it('lets a super-admin bypass every check including production', () => {
    const ctx = contextWith({ isSuperAdmin: true })
    expect(can(ctx, PERMISSIONS.settings.manage)).toBe(true)
    expect(
      can(ctx, PERMISSIONS.deployment.create, { projectId: 'p1', isProductionEnvironment: true }),
    ).toBe(true)
  })
})

describe('project scoping', () => {
  it('returns null (meaning "all projects") for a global grant', () => {
    const ctx = contextWith({ global: [PERMISSIONS.deployment.read] })
    expect(projectScopeFor(ctx, PERMISSIONS.deployment.read)).toBeNull()
    expect(projectFilter(ctx, PERMISSIONS.deployment.read)).toEqual({})
  })

  it('lists only projects where the permission is held', () => {
    const ctx = contextWith({
      byProject: {
        p1: [PERMISSIONS.deployment.read],
        p2: [PERMISSIONS.project.read],
        p3: [PERMISSIONS.deployment.read],
      },
    })
    expect(projectScopeFor(ctx, PERMISSIONS.deployment.read)?.sort()).toEqual(['p1', 'p3'])
  })

  /**
   * The most consequential test in this file.
   *
   * An actor with no grants must produce a filter that matches NOTHING. Returning
   * `{}` here would expose every row in the collection — the classic broken
   * object-level authorization bug.
   */
  it('produces a match-nothing filter for an actor with no grants', () => {
    const ctx = contextWith({})
    expect(projectScopeFor(ctx, PERMISSIONS.deployment.read)).toEqual([])
    expect(projectFilter(ctx, PERMISSIONS.deployment.read)).toEqual({ projectId: { in: [] } })
  })

  it('supports a custom field name', () => {
    const ctx = contextWith({ byProject: { p1: [PERMISSIONS.deployment.read] } })
    expect(projectFilter(ctx, PERMISSIONS.deployment.read, 'project')).toEqual({
      project: { in: ['p1'] },
    })
  })

  it('canOnAnyProject finds a grant held on a single project', () => {
    const ctx = contextWith({ byProject: { p1: [PERMISSIONS.deployment.create] } })
    expect(canOnAnyProject(ctx, PERMISSIONS.deployment.create)).toBe(true)
    expect(canOnAnyProject(ctx, PERMISSIONS.template.publish)).toBe(false)
  })
})

describe('requirePermission', () => {
  it('throws ForbiddenError naming the missing permission', () => {
    const ctx = contextWith({})
    expect(() => requirePermission(ctx, PERMISSIONS.deployment.complete)).toThrowError(
      /deployment\.complete/,
    )
  })

  it('does not throw when the permission is held', () => {
    const ctx = contextWith({ global: [PERMISSIONS.deployment.complete] })
    expect(() => requirePermission(ctx, PERMISSIONS.deployment.complete)).not.toThrow()
  })
})

describe('resolvePermissions', () => {
  const rolesById = new Map([
    ['r-admin', { id: 'r-admin', key: 'admin', permissions: ['*'], isSuperAdmin: true }],
    [
      'r-dev',
      {
        id: 'r-dev',
        key: 'developer',
        permissions: [PERMISSIONS.deployment.read, PERMISSIONS.deployment.create],
        isSuperAdmin: false,
      },
    ],
    [
      'r-qa',
      { id: 'r-qa', key: 'qa', permissions: [PERMISSIONS.deployment.execute], isSuperAdmin: false },
    ],
  ])

  it('flattens global roles', () => {
    const result = resolvePermissions({ globalRoleIds: ['r-dev'], memberships: [], rolesById })
    expect(result.global.has(PERMISSIONS.deployment.read)).toBe(true)
    expect(result.isSuperAdmin).toBe(false)
  })

  it('detects the super-admin wildcard', () => {
    const result = resolvePermissions({ globalRoleIds: ['r-admin'], memberships: [], rolesById })
    expect(result.isSuperAdmin).toBe(true)
  })

  it('keeps project grants separate per project', () => {
    const result = resolvePermissions({
      globalRoleIds: ['r-dev'],
      memberships: [{ projectId: 'p1', roleId: 'r-qa' }],
      rolesById,
    })
    expect(result.global.has(PERMISSIONS.deployment.create)).toBe(true)
    expect(result.byProject.get('p1')?.has(PERMISSIONS.deployment.execute)).toBe(true)
    expect(result.byProject.get('p1')?.has(PERMISSIONS.deployment.create)).toBe(false)
  })

  it('ignores a deleted or unknown role rather than throwing', () => {
    const result = resolvePermissions({
      globalRoleIds: ['r-does-not-exist'],
      memberships: [],
      rolesById,
    })
    expect(result.global.size).toBe(0)
  })

  it('prunes permissions that left the catalog and reports them', () => {
    const stale: string[] = []
    const withStale = new Map(rolesById)
    withStale.set('r-old', {
      id: 'r-old',
      key: 'legacy',
      permissions: [PERMISSIONS.project.read, 'deployment.teleport'],
      isSuperAdmin: false,
    })

    const result = resolvePermissions({
      globalRoleIds: ['r-old'],
      memberships: [],
      rolesById: withStale,
      onStale: (_key, unknown) => stale.push(...unknown),
    })

    expect(result.global.has(PERMISSIONS.project.read)).toBe(true)
    expect(result.global.has('deployment.teleport')).toBe(false)
    expect(stale).toEqual(['deployment.teleport'])
  })
})

describe('pruneUnknown', () => {
  it('accepts catalog permissions, the wildcard, and valid prefix wildcards', () => {
    const { valid, unknown } = pruneUnknown([
      PERMISSIONS.project.read,
      '*',
      'deployment.*',
      'deployment.item.*',
    ])
    expect(unknown).toEqual([])
    expect(valid).toHaveLength(4)
  })

  it('rejects a typo in a prefix wildcard rather than silently granting nothing', () => {
    const { unknown } = pruneUnknown(['deployments.*'])
    expect(unknown).toEqual(['deployments.*'])
  })

  it('rejects an unknown permission', () => {
    const { unknown } = pruneUnknown(['project.teleport'])
    expect(unknown).toEqual(['project.teleport'])
  })
})

describe('serializeAbilities', () => {
  it('sends answers, not rules, to the client', () => {
    const ctx = contextWith({
      global: [PERMISSIONS.deployment.read],
      byProject: { p1: [PERMISSIONS.deployment.execute] },
    })

    const abilities = serializeAbilities(ctx, [
      { key: 'canRead', permission: PERMISSIONS.deployment.read },
      { key: 'canExecute', permission: PERMISSIONS.deployment.execute, scope: { projectId: 'p1' } },
      { key: 'canComplete', permission: PERMISSIONS.deployment.complete, scope: { projectId: 'p1' } },
    ])

    expect(abilities).toEqual({ canRead: true, canExecute: true, canComplete: false })
    // Plain booleans only — no permission strings or role data cross the boundary.
    expect(Object.values(abilities).every((v) => typeof v === 'boolean')).toBe(true)
  })
})
