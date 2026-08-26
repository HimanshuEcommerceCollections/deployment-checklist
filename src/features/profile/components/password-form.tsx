'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@/lib/http/action-result'

import { changePassword } from '../actions/profile.actions'

type State = ActionResult<undefined> | null

/**
 * The page previously posted this to `/api/profile/password`, a route that was
 * never written — so nobody could change their password.
 *
 * A successful change bumps `User.sessionEpoch`, which invalidates every JWT
 * issued before it, including the one making this request. So the session is
 * already dead by the time we render: the only honest thing to do is say so and
 * send the user to sign in again. Staying on the page would 500 on the next
 * navigation, because getRequestContext() rejects a stale epoch.
 */
export function PasswordForm() {
  const router = useRouter()
  const [done, setDone] = useState(false)

  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const result = await changePassword({
      currentPassword: String(formData.get('currentPassword') ?? ''),
      newPassword: String(formData.get('newPassword') ?? ''),
      confirmPassword: String(formData.get('confirmPassword') ?? ''),
    })

    if (result.ok) {
      setDone(true)
      // Give the message a beat to be read, then land on the sign-in page.
      setTimeout(() => router.push('/login?reason=password-changed'), 2500)
    }

    return result
  }, null)

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  if (done) {
    return (
      <div className="rounded-lg border border-go/40 bg-go-surface p-4 text-sm text-go">
        <p className="font-medium">Password changed.</p>
        <p className="mt-1">
          Every existing session was signed out, including this one. Redirecting you to sign in…
        </p>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      {state && !state.ok && (
        <div className="rounded-lg border border-blocked/40 bg-blocked-surface p-3 text-sm text-blocked">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
        {fieldError('currentPassword') && (
          <p className="mt-1 text-xs text-blocked">{fieldError('currentPassword')}</p>
        )}
      </div>

      <div>
        <Label htmlFor="newPassword">New password</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          disabled={pending}
        />
        {fieldError('newPassword') && (
          <p className="mt-1 text-xs text-blocked">{fieldError('newPassword')}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">At least 8 characters.</p>
      </div>

      <div>
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          disabled={pending}
        />
        {fieldError('confirmPassword') && (
          <p className="mt-1 text-xs text-blocked">{fieldError('confirmPassword')}</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Changing your password signs out every device, including this one.
      </p>

      <Button type="submit" disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </Button>
    </form>
  )
}
