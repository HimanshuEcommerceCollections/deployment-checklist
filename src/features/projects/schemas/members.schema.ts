import { z } from 'zod'

/**
 * Project assignment. No roles: which roles a person holds lives on the user, and
 * an assignment only decides which projects those roles reach.
 */
export const AssignProjectSchema = z
  .object({
    /** MongoDB ObjectId — 24 hex characters. */
    userId: z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid user id'),
  })
  .strict()

export type AssignProjectInput = z.infer<typeof AssignProjectSchema>
