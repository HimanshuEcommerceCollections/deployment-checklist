'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Setting } from '@prisma/client'

import { updateSettings } from '../actions/settings.actions'

interface SettingsFormProps {
  settings: Setting
}

export function SettingsForm({ settings }: SettingsFormProps) {
  const [state, formAction, pending] = useActionState(updateSettings, null)

  return (
    <form action={formAction} className="space-y-8">
      {!state?.ok && state && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {state.message}
        </div>
      )}

      {state?.ok && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
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
            <span className="text-sm text-gray-600">{settings.primaryColor}</span>
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
            <span className="text-sm">Require mixed case passwords</span>
          </label>
        </div>
      </fieldset>

      {/* Email Section */}
      <fieldset className="space-y-4 rounded-lg border p-4 opacity-75">
        <legend className="text-sm font-semibold text-gray-600">Email (Read-only)</legend>
        <p className="text-xs text-gray-500">Email is controlled by environment variables. Configure provider in your deployment settings.</p>

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

      {/* Storage Section */}
      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="text-sm font-semibold">Storage</legend>

        <div>
          <Label htmlFor="maxUploadMb">Max Upload Size (MB)</Label>
          <Input
            id="maxUploadMb"
            name="maxUploadMb"
            type="number"
            defaultValue={settings.maxUploadMb}
            min={1}
            max={500}
            disabled={pending}
          />
        </div>
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save Settings'}
      </Button>
    </form>
  )
}
