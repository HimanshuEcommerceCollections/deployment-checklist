import { z } from 'zod'

export const PublishVersionSchema = z.object({}).strict()

export const CreateSectionSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    order: z.number().nonnegative(),
  })
  .strict()

export type CreateSectionInput = z.infer<typeof CreateSectionSchema>

export const UpdateSectionSchema = CreateSectionSchema
export type UpdateSectionInput = z.infer<typeof UpdateSectionSchema>

export const CreateItemSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(2000).optional(),
    requiresEvidence: z.boolean().default(false),
    order: z.number().nonnegative(),
  })
  .strict()

export type CreateItemInput = z.infer<typeof CreateItemSchema>

export const UpdateItemSchema = CreateItemSchema
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>
