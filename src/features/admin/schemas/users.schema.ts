import { z } from 'zod'

export const InviteUserSchema = z
  .object({
    email: z.string().email().toLowerCase(),
    name: z.string().max(100).optional(),
    roleIds: z.string().array().min(1, 'Select at least one role'),
  })
  .strict()

export type InviteUserInput = z.infer<typeof InviteUserSchema>

export const UpdateUserSchema = z
  .object({
    name: z.string().max(100),
    status: z.enum(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']),
    roleIds: z.string().array(),
  })
  .strict()

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>
