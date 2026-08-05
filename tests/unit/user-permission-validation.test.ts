import { describe, expect, it } from 'vitest'

import { UpdateUserSchema } from '@/features/admin/schemas/users.schema'
import { PERMISSIONS, WILDCARD } from '@/lib/authz/permissions'

/**
 * The boundary rules for per-user permissions.
 *
 * These are the invariants the rest of the model assumes, so they are asserted at
 * the schema rather than trusted: the service, the resolver and the UI all rely on
 * `extra` and `revoked` being disjoint sets of real catalog keys.
 */
const base = {
  name: 'Someone',
  status: 'ACTIVE' as const,
  roleIds: [],
}

describe('UpdateUserSchema permission overrides', () => {
  it('defaults both lists so a caller can ignore them', () => {
    const parsed = UpdateUserSchema.parse(base)

    expect(parsed.extraPermissions).toEqual([])
    expect(parsed.revokedPermissions).toEqual([])
  })

  it('accepts real catalog keys', () => {
    const parsed = UpdateUserSchema.parse({
      ...base,
      extraPermissions: [PERMISSIONS.deployment.rollback],
      revokedPermissions: [PERMISSIONS.deployment.create],
    })

    expect(parsed.extraPermissions).toEqual([PERMISSIONS.deployment.rollback])
    expect(parsed.revokedPermissions).toEqual([PERMISSIONS.deployment.create])
  })

  it('rejects a key that is not in the catalog', () => {
    // A typo must fail at the boundary rather than being stored and silently pruned
    // on every request thereafter.
    expect(() =>
      UpdateUserSchema.parse({ ...base, extraPermissions: ['deployment.teleport'] }),
    ).toThrow(/Unknown permission/)
  })

  it('rejects the global wildcard in either list', () => {
    /**
     * Granting it per user would be a super-admin invisible to the role list;
     * revoking it could strip the last administrator without the lockout guard —
     * which reasons about roles — ever noticing.
     */
    expect(() => UpdateUserSchema.parse({ ...base, extraPermissions: [WILDCARD] })).toThrow(
      /wildcard cannot be granted or revoked/,
    )
    expect(() => UpdateUserSchema.parse({ ...base, revokedPermissions: [WILDCARD] })).toThrow(
      /wildcard cannot be granted or revoked/,
    )
  })

  it('rejects a prefix wildcard', () => {
    // Bundling is what roles are for; a per-user grant should say what it grants.
    expect(() =>
      UpdateUserSchema.parse({ ...base, extraPermissions: ['deployment.*'] }),
    ).toThrow(/Unknown permission/)
  })

  it('rejects the same permission being both added and removed', () => {
    expect(() =>
      UpdateUserSchema.parse({
        ...base,
        extraPermissions: [PERMISSIONS.deployment.create],
        revokedPermissions: [PERMISSIONS.deployment.create],
      }),
    ).toThrow(/cannot be both added and removed/)
  })

  it('still refuses unknown top-level keys', () => {
    // `.strict()` survives the refinements — an unexpected field is a client bug.
    expect(() => UpdateUserSchema.parse({ ...base, isAdmin: true })).toThrow()
  })
})
