import 'server-only'

import { env } from '@/lib/config/env'
import { tryOpen } from '@/lib/crypto'
import { logger } from '@/lib/logger'

import { ConsoleEmailProvider, NoopEmailProvider } from './providers/console'
import { GmailSmtpProvider } from './providers/gmail'
import { SmtpEmailProvider } from './providers/smtp'
import type { EmailProvider, EmailProviderConfig } from './types'

/**
 * Provider factory — the ONE place an email transport is constructed.
 *
 * Everything else depends on the `EmailProvider` interface, which is what makes
 * "replace Gmail with Resend" a settings change rather than a refactor.
 *
 * Config precedence is set by EMAIL_CONFIG_SOURCE:
 *
 *   settings (default) — the database `Setting` row wins per field, so an admin
 *                        can switch provider from the UI with no deploy;
 *                        environment variables fill the gaps, which covers
 *                        bootstrap, CI, and a fresh clone with no settings row.
 *   env               — the settings row is ignored for email transport. Use
 *                        this while there is no real provider: `emailProvider`
 *                        defaults to "gmail" in the Prisma schema, so a seeded
 *                        row would otherwise outrank EMAIL_PROVIDER=console and
 *                        send the worker off to Gmail with no credentials.
 *
 * EMAIL_ENABLED is not part of that negotiation. It is a deployment-level kill
 * switch: false there cannot be undone from the admin UI.
 */

export interface SettingsEmailConfig {
  emailProvider: string
  emailEnabled: boolean
  emailFromAddr: string | null
  emailFromName: string | null
  emailReplyTo: string | null
  smtpHost: string | null
  smtpPort: number | null
  smtpSecure: boolean
  smtpUsername: string | null
  /** Ciphertext envelope. Decrypted here and nowhere else. */
  smtpSecretRef: string | null
  emailApiKeyRef: string | null
  emailDailyCap: number
}

export function createEmailProvider(config: EmailProviderConfig): EmailProvider {
  switch (config.provider) {
    case 'gmail':
      return new GmailSmtpProvider(config)
    case 'smtp':
      return new SmtpEmailProvider(config)
    case 'console':
      return new ConsoleEmailProvider()
    case 'noop':
      return new NoopEmailProvider()
    case 'resend':
    case 'ses':
    case 'sendgrid':
    case 'postmark':
      // The interface is ready; the adapters are not written yet. Failing loudly
      // beats silently falling back to console and losing real invitations.
      throw new Error(
        `Email provider "${config.provider}" is not implemented yet. Add an adapter in ` +
          `src/lib/notifications/providers/ implementing EmailProvider, then register it here. ` +
          `Nothing else needs to change.`,
      )
    default:
      throw new Error(`Unknown email provider: ${String(config.provider)}`)
  }
}

/** Build provider config from environment variables alone. */
export function emailConfigFromEnv(): EmailProviderConfig {
  return {
    enabled: env.EMAIL_ENABLED,
    provider: env.EMAIL_PROVIDER,
    fromAddress: env.EMAIL_FROM_ADDRESS ?? 'no-reply@localhost',
    fromName: env.EMAIL_FROM_NAME,
    replyTo: env.EMAIL_REPLY_TO,
    smtp:
      env.SMTP_HOST && env.SMTP_USERNAME && env.SMTP_PASSWORD
        ? {
            host: env.SMTP_HOST,
            port: env.SMTP_PORT ?? 465,
            secure: env.SMTP_SECURE,
            username: env.SMTP_USERNAME,
            password: env.SMTP_PASSWORD,
          }
        : undefined,
    apiKey: env.EMAIL_API_KEY,
    region: env.AWS_REGION,
  }
}

/**
 * Build provider config from settings, falling back to env per field.
 *
 * The fallback is per-field rather than all-or-nothing so a half-configured
 * settings row does not silently discard working env credentials.
 *
 * Two env-level overrides sit above that merge: EMAIL_CONFIG_SOURCE=env skips it
 * entirely, and EMAIL_ENABLED=false survives it.
 */
export function emailConfigFromSettings(settings: SettingsEmailConfig | null): EmailProviderConfig {
  const fallback = emailConfigFromEnv()

  if (!settings || env.EMAIL_CONFIG_SOURCE === 'env') return fallback

  const provider = (settings.emailProvider || fallback.provider) as EmailProvider['name']

  const password = tryOpen(settings.smtpSecretRef) ?? fallback.smtp?.password
  const host = settings.smtpHost ?? fallback.smtp?.host
  const username = settings.smtpUsername ?? fallback.smtp?.username

  return {
    // AND, not override. An admin can turn email off for their organisation; an
    // admin cannot turn it back on for a deployment that has no provider.
    enabled: fallback.enabled && settings.emailEnabled,
    provider,
    fromAddress: settings.emailFromAddr ?? fallback.fromAddress,
    fromName: settings.emailFromName ?? fallback.fromName,
    replyTo: settings.emailReplyTo ?? fallback.replyTo,
    smtp:
      host && username && password
        ? {
            host,
            port: settings.smtpPort ?? fallback.smtp?.port ?? 465,
            secure: settings.smtpSecure,
            username,
            password,
          }
        : undefined,
    apiKey: tryOpen(settings.emailApiKeyRef) ?? fallback.apiKey,
    region: fallback.region,
    dailyCap: settings.emailDailyCap,
  }
}

/**
 * Why email is off — recorded on every skipped outbox row.
 *
 * "Nothing arrived" is the hardest email problem to diagnose, so the row itself
 * says which switch is responsible rather than leaving someone to compare the
 * admin UI against the deployment's environment.
 */
export function describeEmailDisabled(settings: SettingsEmailConfig | null): string {
  if (!env.EMAIL_ENABLED) {
    return 'Skipped — email disabled for this deployment (EMAIL_ENABLED=false)'
  }
  if (settings && !settings.emailEnabled) {
    return 'Skipped — email disabled in organisation settings'
  }
  return 'Skipped — email disabled'
}

/**
 * Resolve a provider, degrading to console rather than throwing.
 *
 * Used by the outbox worker: a misconfigured provider must not crash the drain
 * loop, because that would also stall every other queued notification. The
 * failure is logged at error level and surfaces on the admin outbox page.
 */
export function resolveEmailProviderSafely(config: EmailProviderConfig): EmailProvider {
  try {
    return createEmailProvider(config)
  } catch (error) {
    logger.error(
      { err: error, provider: config.provider },
      'email provider misconfigured — falling back to console so the queue keeps draining',
    )
    return new ConsoleEmailProvider()
  }
}
