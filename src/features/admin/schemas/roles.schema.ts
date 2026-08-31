import { z } from 'zod'

export const CreateRoleSchema = z
  .object({
    name: z.string().min(1).max(100),
    // Hyphens included: the seeded system keys use them ('super-admin',
    // 'release-manager'), and editing such a role submits its key back.
    key: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'Lowercase, numbers, underscores and hyphens only'),
    description: z.string().max(500).optional(),
    permissions: z.string().array().default([]),
    isAssignableGlobally: z.boolean().default(true),
  })
  .strict()

export type CreateRoleInput = z.infer<typeof CreateRoleSchema>
export const UpdateRoleSchema = CreateRoleSchema
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>
