import { z } from 'zod'

export const CreateProjectSchema = z
  .object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
    environments: z.string().array().default([]),
  })
  .strict()

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>
export const UpdateProjectSchema = CreateProjectSchema
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>
