import { z } from 'zod'

export const CreateApiKeySchema = z
  .object({
    name: z.string().min(1).max(100),
    scopes: z.string().array().min(1),
    expiresInDays: z.number().positive().optional(),
  })
  .strict()

export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>
