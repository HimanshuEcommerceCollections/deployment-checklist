import { z } from 'zod'

export const AddMemberSchema = z
  .object({
    userId: z.string(),
    roleIds: z.string().array().min(1),
  })
  .strict()

export type AddMemberInput = z.infer<typeof AddMemberSchema>

export const UpdateMemberSchema = z
  .object({
    roleIds: z.string().array().min(1),
  })
  .strict()

export type UpdateMemberInput = z.infer<typeof UpdateMemberSchema>
