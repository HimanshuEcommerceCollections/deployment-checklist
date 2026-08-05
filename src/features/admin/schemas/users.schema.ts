import { z } from 'zod'

import { WILDCARD, isKnownPermission } from '@/lib/authz/permissions'

export const InviteUserSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    name: z.string().max(100).optional(),
    roleIds: z.string().array().min(1, 'Select at least one role'),
  })
  .strict()

export type InviteUserInput = z.infer<typeof InviteUserSchema>

/**
 * A per-user permission key.
 *
 * Two rules, both to keep the model comprehensible rather than to be strict for its
 * own sake:
 *
 *   • Exact catalog keys only — no `deployment.*`. Bundling is what roles are for,
 *     and a wildcard granted to one person is a role nobody can review.
 *   • Never the global wildcard. If someone needs everything, give them the Admin
 *     role; a per-user `*` would be a super-admin invisible to the role list, and a
 *     revocable one could strip the last administrator without the lockout guard —
 *     which reasons about roles — ever noticing.
 */
const permissionKey = z
  .string()
  .refine((key) => key !== WILDCARD, 'The wildcard cannot be granted or revoked per user')
  .refine(isKnownPermission, (key) => ({ message: `Unknown permission "${key}"` }))

export const UpdateUserSchema = z
  .object({
    name: z.string().max(100),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    roleIds: z.string().array(),
    /** Granted on top of the roles. */
    extraPermissions: permissionKey.array().default([]),
    /** Withheld despite a role granting it. */
    revokedPermissions: permissionKey.array().default([]),
  })
  .strict()
  /**
   * The invariant the whole model rests on. "Granted and withheld" has no meaning,
   * and allowing it would make the effective set depend on evaluation order rather
   * than on anything an administrator chose. The UI cannot produce it — un-ticking a
   * manually added permission deletes it from `extra` rather than adding a
   * revocation — so this catches a bad API caller, not a bad click.
   */
  .refine(
    (input) => !input.extraPermissions.some((key) => input.revokedPermissions.includes(key)),
    {
      message: 'A permission cannot be both added and removed',
      path: ['extraPermissions'],
    },
  )

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
