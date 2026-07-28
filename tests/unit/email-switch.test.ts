import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SettingsEmailConfig } from '@/lib/notifications/registry'

/**
 * The env-level email switches.
 *
 * These exist because there is no email provider yet, and the failure they
 * prevent is the quiet kind: `Setting.emailProvider` defaults to "gmail" in the
 * Prisma schema, so a seeded settings row outranks EMAIL_PROVIDER=console and
 * the worker starts dialling Gmail with no credentials.
 *
 * Every case reloads the module graph, because env.ts caches its parse after the
 * first read — which is correct in production and inconvenient here.
 */

/** A fully-populated settings row that disagrees with the environment. */
const settingsRow: SettingsEmailConfig = {
  emailProvider: 'gmail',
  emailEnabled: true,
  emailFromAddr: 'settings@example.com',
  emailFromName: 'From Settings',
  emailReplyTo: null,
  smtpHost: 'smtp.settings.example.com',
  smtpPort: 2525,
  smtpSecure: true,
  smtpUsername: 'settings-user',
  smtpSecretRef: null,
  emailApiKeyRef: null,
  emailDailyCap: 400,
}

/** Load registry.ts against a specific environment. */
async function loadRegistry(overrides: Record<string, string>) {
  vi.resetModules()
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value)
  }
  return import('@/lib/notifications/registry')
}

beforeEach(() => {
  // Neutral baseline: individual cases opt into the values they care about.
  vi.stubEnv('EMAIL_PROVIDER', 'console')
  vi.stubEnv('EMAIL_ENABLED', 'true')
  vi.stubEnv('EMAIL_CONFIG_SOURCE', 'settings')
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('EMAIL_ENABLED', () => {
  it('treats a blank value as the default rather than as false', async () => {
    // `EMAIL_ENABLED=""` is what a key left empty in .env.example looks like.
    // Reading that as "off" would disable email for anyone who copied the file.
    const { emailConfigFromEnv } = await loadRegistry({ EMAIL_ENABLED: '' })

    expect(emailConfigFromEnv().enabled).toBe(true)
  })

  it('accepts 1 and 0 as well as true and false', async () => {
    const off = await loadRegistry({ EMAIL_ENABLED: '0' })
    expect(off.emailConfigFromEnv().enabled).toBe(false)

    const on = await loadRegistry({ EMAIL_ENABLED: '1' })
    expect(on.emailConfigFromEnv().enabled).toBe(true)
  })

  it('disables email regardless of the settings row', async () => {
    const { emailConfigFromSettings } = await loadRegistry({ EMAIL_ENABLED: 'false' })

    // The row says enabled: true. The environment still wins.
    expect(settingsRow.emailEnabled).toBe(true)
    expect(emailConfigFromSettings(settingsRow).enabled).toBe(false)
  })

  it('cannot be re-enabled from the admin settings row', async () => {
    const { emailConfigFromSettings } = await loadRegistry({ EMAIL_ENABLED: 'false' })

    expect(emailConfigFromSettings({ ...settingsRow, emailEnabled: true }).enabled).toBe(false)
  })

  it('lets an admin still switch email off for their organisation', async () => {
    const { emailConfigFromSettings } = await loadRegistry({ EMAIL_ENABLED: 'true' })

    expect(emailConfigFromSettings({ ...settingsRow, emailEnabled: false }).enabled).toBe(false)
    expect(emailConfigFromSettings({ ...settingsRow, emailEnabled: true }).enabled).toBe(true)
  })
})

describe('EMAIL_CONFIG_SOURCE', () => {
  it('settings — the row wins per field, env fills the gaps', async () => {
    const { emailConfigFromSettings } = await loadRegistry({
      EMAIL_CONFIG_SOURCE: 'settings',
      EMAIL_PROVIDER: 'console',
      AWS_REGION: 'eu-west-1',
    })

    const config = emailConfigFromSettings(settingsRow)

    expect(config.provider).toBe('gmail')
    expect(config.fromAddress).toBe('settings@example.com')
    // Not present on the row, so it falls back to the environment.
    expect(config.region).toBe('eu-west-1')
  })

  it('env — the settings row is ignored entirely for transport', async () => {
    const { emailConfigFromSettings } = await loadRegistry({
      EMAIL_CONFIG_SOURCE: 'env',
      EMAIL_PROVIDER: 'console',
      EMAIL_FROM_NAME: 'From Env',
    })

    const config = emailConfigFromSettings(settingsRow)

    // This is the whole point: a seeded "gmail" row does not hijack the worker.
    expect(config.provider).toBe('console')
    expect(config.fromName).toBe('From Env')
    expect(config.smtp?.host).not.toBe('smtp.settings.example.com')
  })

  it('env — EMAIL_ENABLED still governs', async () => {
    const { emailConfigFromSettings } = await loadRegistry({
      EMAIL_CONFIG_SOURCE: 'env',
      EMAIL_ENABLED: 'false',
    })

    expect(emailConfigFromSettings(settingsRow).enabled).toBe(false)
  })

  it('falls back to env when there is no settings row at all', async () => {
    const { emailConfigFromSettings } = await loadRegistry({ EMAIL_PROVIDER: 'console' })

    expect(emailConfigFromSettings(null).provider).toBe('console')
  })
})

describe('describeEmailDisabled', () => {
  it('names the environment switch when that is the cause', async () => {
    const { describeEmailDisabled } = await loadRegistry({ EMAIL_ENABLED: 'false' })

    // "Nothing arrived" is the hardest email problem to diagnose, so the reason
    // recorded on the row has to say which switch is responsible.
    expect(describeEmailDisabled(settingsRow)).toContain('EMAIL_ENABLED=false')
  })

  it('names the settings row when the environment allows email', async () => {
    const { describeEmailDisabled } = await loadRegistry({ EMAIL_ENABLED: 'true' })

    expect(describeEmailDisabled({ ...settingsRow, emailEnabled: false })).toContain(
      'organisation settings',
    )
  })
})
