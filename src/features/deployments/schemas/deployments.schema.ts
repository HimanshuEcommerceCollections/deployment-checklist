import { z } from 'zod'

export const CreateDeploymentSchema = z
  .object({
    projectId: z.string(),
    templateVersionId: z.string(),
    title: z.string().min(1).max(300),
    releaseNotes: z.string().max(5000).optional(),
    environment: z.string(),
  })
  .strict()

export type CreateDeploymentInput = z.infer<typeof CreateDeploymentSchema>

export const UpdateDeploymentItemSchema = z
  .object({
    checked: z.boolean(),
    skipped: z.boolean().default(false),
  })
  .strict()

export type UpdateDeploymentItemInput = z.infer<typeof UpdateDeploymentItemSchema>

export const CreateCommentSchema = z
  .object({
    content: z.string().min(1).max(5000),
  })
  .strict()

export type CreateCommentInput = z.infer<typeof CreateCommentSchema>
