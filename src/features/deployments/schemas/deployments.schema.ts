import { z } from 'zod'

import { DEPLOYMENT_TRANSITIONS } from '@/domain/deployments/lifecycle'

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

/**
 * A status change. `transition` names the verb rather than the target status, so
 * the client cannot ask for "set status to COMPLETED" and bypass the rules about
 * which statuses that is legal from — the state machine owns that mapping.
 *
 * Whether a reason is required is decided by TRANSITION_RULES rather than here:
 * the service enforces it for every caller, including a future REST door, and a
 * schema-level requirement would have to duplicate the table to know.
 */
export const TransitionDeploymentSchema = z
  .object({
    transition: z.enum(DEPLOYMENT_TRANSITIONS),
    reason: z.string().trim().min(1, 'Please give a brief reason').max(500).optional(),
  })
  .strict()

export type TransitionDeploymentInput = z.infer<typeof TransitionDeploymentSchema>
