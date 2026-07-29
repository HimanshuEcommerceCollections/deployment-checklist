import { z } from 'zod'

export const UpdateOrganizationSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .min(2)
      .max(60)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens only'),
  })
  .strict()

export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema>
