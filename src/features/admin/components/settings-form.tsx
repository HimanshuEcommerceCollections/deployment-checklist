'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ActionResult } from '@/lib/http/action-result'

import { updateSettings } from '../actions/settings.actions'

/**
 * Exactly the columns this form edits — deliberately NOT Prisma's `Setting`.
 * Demanding the whole row forced the page to ship every column to the client,
 * secret refs included, just to satisfy the type.
 */
interface SettingsFormProps {
  settings: {
    companyName: string
    supportEmail: string | null
    primaryColor: string
    defaultTheme: string
    sessionTimeoutMinutes: number
    sessionAbsoluteHours: number
    inviteExpiryHours: number
    passwordMinLength: number
    passwordRequireMixed: boolean
    maxFailedLogins: number
    lockoutMinutes: number
    emailDailyCap: number
    emailRetryLimit: number
  }
}

type State = ActionResult<{ companyName: string }> | null

export function SettingsForm({ settings }: SettingsFormProps) {
  /**
   * The action is wrapped, never passed to useActionState directly.
   *
   * React invokes the callback as `(previousState, formData)` — and the old code
   * passed `updateSettings` itself, so the server action received the PREVIOUS
   * STATE (null on first submit) where it expected the payload. Every save failed
   * Zod validation on `null`, which means this form had never saved once, and
   * every "setting" in it silently kept its old value.
   */
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_previous, formData) =>
      updateSettings({
        companyName: String(formData.get('companyName') ?? ''),
        supportEmail: String(formData.get('supportEmail') ?? ''),
        primaryColor: String(formData.get('primaryColor') ?? ''),
        defaultTheme: String(formData.get('defaultTheme') ?? 'dark'),
        // Strings on purpose: the schema's z.coerce owns the number parsing, so
        // client and server cannot disagree about what "42" means.
        sessionTimeoutMinutes: formData.get('sessionTimeoutMinutes'),
        sessionAbsoluteHours: formData.get('sessionAbsoluteHours'),
        inviteExpiryHours: formData.get('inviteExpiryHours'),
        passwordMinLength: formData.get('passwordMinLength'),
        passwordRequireMixed: formData.get('passwordRequireMixed') === 'on',
        maxFailedLogins: formData.get('maxFailedLogins'),
        lockoutMinutes: formData.get('lockoutMinutes'),
        emailDailyCap: formData.get('emailDailyCap'),
        emailRetryLimit: formData.get('emailRetryLimit'),
      }),
    null,
  )

  return (
    <form action={formAction} className="space-y-8">
      {!state?.ok && state && (
        <div className="rounded-lg border border-blocked/40 bg-blocked-surface p-4 text-sm text-blocked">
          {state.message}
        </div>
      )}

      {state?.ok && (
        <div className="rounded-lg border border-go/40 bg-go-surface p-4 text-sm text-go">
          Settings updated successfully
        </div>
      )}

      {/* Branding Section */}
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="text-sm font-semibold">Branding</legend>

        <div>
          <Label htmlFor="companyName">Company Name</Label>
          <Input
            id="companyName"
            name="companyName"
            defaultValue={settings.companyName}
            required
            maxLength={100}
            disabled={pending}
          />
        </div>

        <div>
          <Label htmlFor="supportEmail">Support Email</Label>
          <Input
            id="supportEmail"
            name="supportEmail"
            type="email"
            defaultValue={settings.supportEmail ?? ''}
            disabled={pending}
          />
        </div>

        <div>
          <Label htmlFor="primaryColor">Primary Color</Label>
          <div className="flex items-center gap-2">
            <Input
              id="primaryColor"
              name="primaryColor"
              type="color"
              defaultValue={settings.primaryColor}
              disabled={pending}
              className="h-10 w-20"
            />
            <span className="text-sm text-muted-foreground">{settings.primaryColor}</span>
          </div>
        </div>

        <div>
          <Label htmlFor="defaultTheme">Default Theme</Label>
          <Select name="defaultTheme" defaultValue={settings.defaultTheme} disabled={pending}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </fieldset>

      {/* Auth Policy Section */}
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="text-sm font-semibold">Authentication & Security</legend>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="sessionTimeoutMinutes">Session Timeout (minutes)</Label>
            <Input
              id="sessionTimeoutMinutes"
              name="sessionTimeoutMinutes"
              type="number"
              defaultValue={settings.sessionTimeoutMinutes}
              min={5}
              max={1440}
              disabled={pending}
            />
          </div>

          <div>
            <Label htmlFor="sessionAbsoluteHours">Absolute Session Duration (hours)</Label>
            <Input
              id="sessionAbsoluteHours"
              name="sessionAbsoluteHours"
              type="number"
              defaultValue={settings.sessionAbsoluteHours}
              min={1}
              max={8760}
              disabled={pending}
            />
          </div>

          <div>
            <Label htmlFor="inviteExpiryHours">Invite Expiry (hours)</Label>
            <Input
              id="inviteExpiryHours"
              name="inviteExpiryHours"
              type="number"
              defaultValue={settings.inviteExpiryHours}
              min={1}
              max={720}
              disabled={pending}
            />
          </div>

          <div>
            <Label htmlFor="passwordMinLength">Password Minimum Length</Label>
            <Input
              id="passwordMinLength"
              name="passwordMinLength"
              type="number"
              defaultValue={settings.passwordMinLength}
              min={8}
              max={128}
              disabled={pending}
            />
          </div>

          <div>
            <Label htmlFor="maxFailedLogins">Max Failed Logins</Label>
            <Input
              id="maxFailedLogins"
              name="maxFailedLogins"
              type="number"
              defaultValue={settings.maxFailedLogins}
              min={1}
              max={100}
              disabled={pending}
            />
          </div>

          <div>
            <Label htmlFor="lockoutMinutes">Lockout Duration (minutes)</Label>
            <Input
              id="lockoutMinutes"
              name="lockoutMinutes"
              type="number"
              defaultValue={settings.lockoutMinutes}
              min={1}
              max={1440}
              disabled={pending}
            />
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="passwordRequireMixed"
              defaultChecked={settings.passwordRequireMixed}
              disabled={pending}
            />
            <span className="text-sm">Also require mixed case and a number</span>
          </label>
          {/* Length is the only rule unless this is on — worth saying, since the
              default changed and an admin may remember the stricter behaviour. */}
          <p className="mt-1 text-xs text-muted-foreground">
            Off by default. With it off, minimum length is the only password rule.
          </p>
        </div>
      </fieldset>

      {/* Email Section */}
      <fieldset className="space-y-4 rounded-lg border p-4 opacity-75">
        <legend className="text-sm font-semibold text-muted-foreground">Email (Read-only)</legend>
        <p className="text-xs text-muted-foreground">Email is controlled by environment variables. Configure provider in your deployment settings.</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="emailDailyCap">Daily Email Cap</Label>
            <Input
              id="emailDailyCap"
              name="emailDailyCap"
              type="number"
              defaultValue={settings.emailDailyCap}
              min={1}
              max={10000}
              disabled={pending}
            />
          </div>

          <div>
            <Label htmlFor="emailRetryLimit">Email Retry Limit</Label>
            <Input
              id="emailRetryLimit"
              name="emailRetryLimit"
              type="number"
              defaultValue={settings.emailRetryLimit}
              min={1}
              max={20}
              disabled={pending}
            />
          </div>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save Settings'}
      </Button>
    </form>
  )
}
