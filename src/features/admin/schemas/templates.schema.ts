import { z } from 'zod'

export const CreateTemplateSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
  })
  .strict()

export type CreateTemplateInput = z.infer<typeof CreateTemplateSchema>
export const UpdateTemplateSchema = CreateTemplateSchema
export type UpdateTemplateInput = z.infer<typeof UpdateTemplateSchema>

export const CreateSectionSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    order: z.number().nonnegative(),
  })
  .strict()

export type CreateSectionInput = z.infer<typeof CreateSectionSchema>

export const CreateItemSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(2000).optional(),
    requiresEvidence: z.boolean().default(false),
    order: z.number().nonnegative(),
  })
  .strict()

export type CreateItemInput = z.infer<typeof CreateItemSchema>
