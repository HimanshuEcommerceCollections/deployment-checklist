import { z } from 'zod'

export const CreateRoleSchema = z
  .object({
    name: z.string().min(1).max(100),
    key: z.string().min(1).max(50).regex(/^[a-z0-9_]+$/, 'Lowercase, numbers, underscores only'),
    description: z.string().max(500).optional(),
    permissions: z.string().array().default([]),
    isAssignableGlobally: z.boolean().default(true),
  })
  .strict()

export type CreateRoleInput = z.infer<typeof CreateRoleSchema>
export const UpdateRoleSchema = CreateRoleSchema
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>
