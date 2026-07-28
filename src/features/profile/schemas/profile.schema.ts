import { z } from 'zod'

export const UpdateProfileSchema = z
  .object({
    name: z.string().min(1).max(100),
    email: z.string().email().max(255),
    jobTitle: z.string().max(100).optional(),
  })
  .strict()

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>

export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
  })
  .strict()
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>
