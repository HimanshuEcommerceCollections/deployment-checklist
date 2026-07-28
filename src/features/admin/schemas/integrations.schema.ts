import { z } from 'zod'

export const CreateIntegrationSchema = z
  .object({
    type: z.enum(['slack', 'github', 'webhook']),
    name: z.string().min(1).max(100),
    config: z.record(z.any()),
    enabled: z.boolean().default(true),
  })
  .strict()

export type CreateIntegrationInput = z.infer<typeof CreateIntegrationSchema>
export const UpdateIntegrationSchema = CreateIntegrationSchema
export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationSchema>
