import { describe, expect, it } from 'vitest'

import {
  effectivePermissions,
  permissionSource,
  reconcileRevocations,
} from '@/domain/authz/effective-permissions'

/**
 * The rule that decides what a user holds.
 *
 * Roles are templates; the per-user sets are exceptions layered over them. The
 * worked example from the specification is asserted verbatim at the bottom, because
 * it is the shape everything else here exists to support.
 */

const sorted = (set: Set<string>) => [...set].sort()

describe('effectivePermissions', () => {
  it('returns the role permissions when there are no overrides', () => {
    const result = effectivePermissions(['a', 'b'], { extra: [], revoked: [] })
    expect(sorted(result)).toEqual(['a', 'b'])
  })

  it('unions several roles', () => {
    const result = effectivePermissions(['a', 'b', 'b', 'c'], { extra: [], revoked: [] })
    expect(sorted(result)).toEqual(['a', 'b', 'c'])
  })

  it('adds extras that no role grants', () => {
    const result = effectivePermissions(['a'], { extra: ['z'], revoked: [] })
    expect(sorted(result)).toEqual(['a', 'z'])
  })

  it('removes revoked permissions even though a role grants them', () => {
    const result = effectivePermissions(['a', 'b'], { extra: [], revoked: ['b'] })
    expect(sorted(result)).toEqual(['a'])
  })

  it('lets revocation win over a role, because it is applied last', () => {
    // The ordering is the whole contract: a removal means "not this, even though the
    // role says so".
    const result = effectivePermissions(['a'], { extra: [], revoked: ['a'] })
    expect(sorted(result)).toEqual([])
  })

  it('ignores a revocation for something nobody granted', () => {
    const result = effectivePermissions(['a'], { extra: [], revoked: ['nope'] })
    expect(sorted(result)).toEqual(['a'])
  })

  it('does not mutate its inputs', () => {
    const fromRoles = ['a', 'b']
    const overrides = { extra: ['z'], revoked: ['b'] }

    effectivePermissions(fromRoles, overrides)

    expect(fromRoles).toEqual(['a', 'b'])
    expect(overrides).toEqual({ extra: ['z'], revoked: ['b'] })
  })
})

describe('reconcileRevocations', () => {
  it('drops a revocation that a newly assigned role grants', () => {
    // The rule that makes Create Deployment come back under QA.
    const result = reconcileRevocations({
      revoked: ['create-deployment'],
      grantedByNewRoles: ['dashboard', 'projects', 'create-deployment', 'view-deployments'],
    })

    expect(result).toEqual([])
  })

  it('keeps a revocation the new role does not grant', () => {
    const result = reconcileRevocations({
      revoked: ['export-reports', 'create-deployment'],
      grantedByNewRoles: ['create-deployment'],
    })

    // Unrelated exceptions survive: adding a role must not silently undo them.
    expect(result).toEqual(['export-reports'])
  })

  it('is a no-op when no role was added', () => {
    const result = reconcileRevocations({
      revoked: ['a', 'b'],
      grantedByNewRoles: [],
    })

    expect(result).toEqual(['a', 'b'])
  })
})

describe('permissionSource', () => {
  const fromRoles = new Set(['a', 'b'])

  it('reports a role grant', () => {
    expect(permissionSource('a', fromRoles, { extra: [], revoked: [] })).toBe('role')
  })

  it('reports a manual addition', () => {
    expect(permissionSource('z', fromRoles, { extra: ['z'], revoked: [] })).toBe('extra')
  })

  it('reports a revocation ahead of the role that granted it', () => {
    // Shown struck through rather than absent, so the choice stays visible.
    expect(permissionSource('b', fromRoles, { extra: [], revoked: ['b'] })).toBe('revoked')
  })

  it('reports nothing for a permission the user does not hold', () => {
    expect(permissionSource('q', fromRoles, { extra: [], revoked: [] })).toBe('none')
  })
})

describe('the worked example from the specification', () => {
  const ENGINEER = ['dashboard', 'projects', 'create-deployment']
  const QA = ['dashboard', 'projects', 'create-deployment', 'view-deployments']

  it('walks assign → customise → reassign exactly as specified', () => {
    // 1. Assign Engineer.
    let extra: string[] = []
    let revoked: string[] = []

    expect(sorted(effectivePermissions(ENGINEER, { extra, revoked }))).toEqual([
      'create-deployment',
      'dashboard',
      'projects',
    ])

    // 2. Remove Create Deployment, add Export Reports.
    revoked = ['create-deployment']
    extra = ['export-reports']

    expect(sorted(effectivePermissions(ENGINEER, { extra, revoked }))).toEqual([
      'dashboard',
      'export-reports',
      'projects',
    ])

    // 3. Assign QA instead. QA grants create-deployment, so that revocation goes.
    revoked = reconcileRevocations({ revoked, grantedByNewRoles: QA })
    expect(revoked).toEqual([])

    expect(sorted(effectivePermissions(QA, { extra, revoked }))).toEqual([
      'create-deployment',
      'dashboard',
      'export-reports',
      'projects',
      'view-deployments',
    ])
  })
})
