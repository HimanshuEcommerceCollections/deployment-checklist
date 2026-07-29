import { z } from 'zod'

export const PublishVersionSchema = z.object({}).strict()

export const CreateSectionSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    key: z.string().max(100).optional(),
    order: z.number().int().nonnegative().optional(),
  })
  .strict()

export type CreateSectionInput = z.infer<typeof CreateSectionSchema>

export const UpdateSectionSchema = CreateSectionSchema.partial()
export type UpdateSectionInput = z.infer<typeof UpdateSectionSchema>

export const CreateItemSchema = z
  .object({
    label: z.string().min(1).max(500),
    helpText: z.string().max(2000).optional(),
    key: z.string().max(100).optional(),
    isRequired: z.boolean().default(true),
    evidenceRequired: z.boolean().default(false),
    ownerRoleKey: z.string().max(100).optional(),
    environmentKeys: z.array(z.string()).default([]),
    order: z.number().int().nonnegative().optional(),
  })
  .strict()

export type CreateItemInput = z.infer<typeof CreateItemSchema>

export const UpdateItemSchema = CreateItemSchema.partial()
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>
