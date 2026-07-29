import { z } from 'zod'

export const CreateDeploymentSchema = z
  .object({
    projectId: z.string(),
    templateVersionId: z.string(),
    environmentId: z.string(),
    version: z.string().min(1).max(50),
    title: z.string().max(300).optional(),
    releaseNotes: z.string().max(5000).optional(),
    scheduledAt: z.coerce.date().optional(),
  })
  .strict()

export type CreateDeploymentInput = z.infer<typeof CreateDeploymentSchema>

export const UpdateDeploymentItemSchema = z
  .object({
    checked: z.boolean(),
    skipped: z.boolean().default(false),
    note: z.string().max(2000).optional(),
    /// Optimistic concurrency guard — the toggle asserts on the revision it read.
    revision: z.number().int().nonnegative().optional(),
  })
  .strict()

export type UpdateDeploymentItemInput = z.infer<typeof UpdateDeploymentItemSchema>

export const CreateCommentSchema = z
  .object({
    body: z.string().min(1).max(5000),
    itemId: z.string().optional(),
    parentId: z.string().optional(),
  })
  .strict()

export type CreateCommentInput = z.infer<typeof CreateCommentSchema>
