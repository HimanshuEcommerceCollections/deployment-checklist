'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@/lib/http/action-result'

import { updateProfile } from '../actions/profile.actions'

interface ProfileFormProps {
  name: string
  email: string
  jobTitle: string | null
}

type State = ActionResult<undefined> | null

/**
 * The page previously posted this to `/api/profile/update`, a route that was
 * never written — so Save Changes did nothing at all. Uses the existing
 * `updateProfile` action directly, matching every other form in the app.
 */
export function ProfileForm({ name, email, jobTitle }: ProfileFormProps) {
  const [state, action, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    return updateProfile({
      name: String(formData.get('name') ?? '').trim(),
      email: String(formData.get('email') ?? '').trim(),
      // `.strict()` with an optional field: send undefined, not '', or an empty
      // input fails max-length coercion on a field left deliberately blank.
      jobTitle: String(formData.get('jobTitle') ?? '').trim() || undefined,
    })
  }, null)

  const fieldError = (field: string) =>
    state && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined

  return (
    <form action={action} className="space-y-4">
      {state?.ok && (
        <div className="rounded-lg border border-go/40 bg-go-surface p-3 text-sm text-go">
          Profile updated.
        </div>
      )}
      {state && !state.ok && (
        <div className="rounded-lg border border-blocked/40 bg-blocked-surface p-3 text-sm text-blocked">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" name="name" defaultValue={name} required maxLength={100} disabled={pending} />
        {fieldError('name') && <p className="mt-1 text-xs text-blocked">{fieldError('name')}</p>}
      </div>

      <div>
        <Label htmlFor="email">Email address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={email}
          required
          maxLength={255}
          disabled={pending}
        />
        {fieldError('email') && <p className="mt-1 text-xs text-blocked">{fieldError('email')}</p>}
        <p className="mt-1 text-xs text-muted-foreground">
          This is also your sign-in address.
        </p>
      </div>

      <div>
        <Label htmlFor="jobTitle">Job title</Label>
        <Input
          id="jobTitle"
          name="jobTitle"
          defaultValue={jobTitle ?? ''}
          maxLength={100}
          placeholder="Optional"
          disabled={pending}
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </form>
  )
}
