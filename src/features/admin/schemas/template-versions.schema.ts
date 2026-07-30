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

/**
 * Reordering sends the full ordered id list, not a from/to pair.
 *
 * `order` is an absolute integer on an embedded array that the service rewrites
 * wholesale anyway, so a positional move would need the client and server to
 * agree on the current indices — and they disagree the moment two people edit
 * the same draft. The full list is self-describing: whatever it says becomes the
 * order, and ids the caller did not send keep their relative position at the end.
 */
export const ReorderSchema = z
  .object({
    orderedIds: z.array(z.string().min(1)).min(1),
  })
  .strict()

export type ReorderInput = z.infer<typeof ReorderSchema>

/**
 * `sourceVersionId` absent = start from an empty draft rather than cloning.
 */
export const CreateDraftVersionSchema = z
  .object({
    sourceVersionId: z.string().min(1).optional(),
    changeNote: z.string().max(2000).optional(),
  })
  .strict()

export type CreateDraftVersionInput = z.infer<typeof CreateDraftVersionSchema>
