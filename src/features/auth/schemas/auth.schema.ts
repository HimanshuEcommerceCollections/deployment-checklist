import { z } from 'zod'

/**
 * Auth validation schemas.
 *
 * Shared by the client form, the Server Action, and the service — one definition,
 * three consumers. `.strict()` throughout: stripping unknown keys silently
 * accepts a payload with extra fields, which is the mass-assignment surface.
 *
 * Pure (no server-only) so the same rules run in the browser for live feedback.
 */

const email = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .max(254, 'That email is too long')
  .email('Enter a valid email address')
  // Lowercased at the boundary so `User.email` uniqueness is meaningful —
  // Alice@x.com and alice@x.com must not become two accounts.
  .transform((value) => value.toLowerCase())

const password = z
  .string()
  .min(1, 'Password is required')
  // Capped because the input is Argon2-hashed: an unbounded password is a
  // CPU-exhaustion vector. 200 is far above any real passphrase.
  .max(200, 'That password is too long')

export const LoginSchema = z
  .object({
    email,
    password,
    next: z.string().optional(),
  })
  .strict()

export type LoginInput = z.infer<typeof LoginSchema>

/**
 * Schema for the Auth.js `authorize` callback — deliberately NOT `.strict()`.
 *
 * Auth.js hands `authorize` the entire posted form body, which includes its own
 * transport fields (`csrfToken`, `callbackUrl`, `redirect`, `json`). A strict
 * schema rejects the whole payload because of them, `authorize` returns null, and
 * every sign-in fails with a generic CredentialsSignin — indistinguishable from a
 * wrong password, and with no service-layer audit row to explain it.
 *
 * So: strict at OUR boundaries (Server Actions, REST) where unknown keys signal a
 * client bug worth surfacing; permissive here, where extra keys are the
 * framework's own and are simply not ours to police. Only email and password are
 * read; everything else is dropped.
 */
export const CredentialsSchema = z.object({ email, password })

export type CredentialsInput = z.infer<typeof CredentialsSchema>

export const ForgotPasswordSchema = z.object({ email }).strict()
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>

/**
 * New-password shape. The strength policy itself lives in
 * `@/lib/auth/password-policy` and is applied in the service, because it depends
 * on org settings (minLength, requireMixed) that a static schema cannot know.
 */
const newPasswordFields = {
  password: z.string().min(8, 'Password is too short').max(200, 'That password is too long'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}

const matchingPasswords = <T extends { password: string; confirmPassword: string }>(schema: z.ZodType<T>) =>
  schema.refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

export const ResetPasswordSchema = matchingPasswords(
  z.object({ token: z.string().min(1), ...newPasswordFields }).strict(),
)
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>

export const AcceptInviteSchema = matchingPasswords(
  z
    .object({
      token: z.string().min(1),
      name: z.string().trim().min(1, 'Your name is required').max(120, 'That name is too long'),
      ...newPasswordFields,
    })
    .strict(),
)
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>

export const ChangePasswordSchema = matchingPasswords(
  z
    .object({
      currentPassword: z.string().min(1, 'Enter your current password'),
      ...newPasswordFields,
    })
    .strict(),
)
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>

/** Objects ids arriving from a URL or a form. Validated before reaching Prisma. */
export const objectId = () =>
  z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid identifier')

export const InviteUserSchema = z
  .object({
    email,
    name: z.string().trim().max(120).optional(),
    roleIds: z.array(objectId()).min(1, 'Select at least one role'),
    projectGrants: z
      .array(z.object({ projectId: objectId(), roleId: objectId() }).strict())
      .max(50)
      .default([]),
    message: z.string().trim().max(1_000).optional(),
  })
  .strict()

export type InviteUserInput = z.infer<typeof InviteUserSchema>
