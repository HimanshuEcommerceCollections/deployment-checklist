import { z } from 'zod'

/**
 * `kind` arrives from a form field, so it is untrusted input that indexes a
 * service switch. Enumerating it here means an unknown kind fails validation at
 * the boundary rather than falling through the switch and returning undefined.
 */
export const TRASH_KINDS = ['project', 'template', 'environment', 'user'] as const

export const RestoreSchema = z
  .object({
    kind: z.enum(TRASH_KINDS),
    /** MongoDB ObjectId — 24 hex characters. */
    id: z.string().regex(/^[0-9a-f]{24}$/i, 'Invalid id'),
  })
  .strict()

export type RestoreInput = z.infer<typeof RestoreSchema>
