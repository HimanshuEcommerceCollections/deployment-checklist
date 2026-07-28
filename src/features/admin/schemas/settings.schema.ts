import { z } from 'zod'

export const UpdateSettingsSchema = z
  .object({
    // Branding
    companyName: z.string().min(1, 'Company name is required').max(100),
    supportEmail: z.string().email().optional().or(z.literal('')),
    primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i, 'Enter a valid hex color'),
    defaultTheme: z.enum(['dark', 'light', 'system']),

    // Auth policy
    sessionTimeoutMinutes: z.coerce.number().int().min(5).max(1440), // 5 min to 24 hours
    sessionAbsoluteHours: z.coerce.number().int().min(1).max(8760), // 1 hour to 1 year
    inviteExpiryHours: z.coerce.number().int().min(1).max(720), // 1 hour to 30 days
    passwordMinLength: z.coerce.number().int().min(8).max(128),
    passwordRequireMixed: z.boolean(),
    maxFailedLogins: z.coerce.number().int().min(1).max(100),
    lockoutMinutes: z.coerce.number().int().min(1).max(1440),

    // Email
    emailDailyCap: z.coerce.number().int().min(1).max(10000),
    emailRetryLimit: z.coerce.number().int().min(1).max(20),

    // Storage
    maxUploadMb: z.coerce.number().int().min(1).max(500),
  })
  .strict()

export type UpdateSettingsInput = z.infer<typeof UpdateSettingsSchema>
