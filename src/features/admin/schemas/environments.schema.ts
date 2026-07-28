import { z } from 'zod'

export const CreateEnvironmentSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(50),
    key: z.string().min(1).max(30).regex(/^[a-z0-9_]+$/, 'Only lowercase letters, numbers, and underscores'),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, 'Valid hex color required'),
    isProduction: z.boolean().default(false),
    order: z.coerce.number().int().min(0),
  })
  .strict()

export type CreateEnvironmentInput = z.infer<typeof CreateEnvironmentSchema>

export const UpdateEnvironmentSchema = CreateEnvironmentSchema

export type UpdateEnvironmentInput = z.infer<typeof UpdateEnvironmentSchema>
