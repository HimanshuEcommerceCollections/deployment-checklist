'use client'

import { useRouter } from 'next/navigation'
import { useActionState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ActionResult } from '@/lib/http/action-result'

import { inviteUser } from '../actions/users.actions'

interface Role {
  id: string
  name: string
  key: string
}

interface InviteUserFormProps {
  roles: Role[]
}

type State = ActionResult<{ invitationId: string }> | null

export function InviteUserForm({ roles }: InviteUserFormProps) {
  const router = useRouter()

  /**
   * One action, wired through useActionState, driving both the submit and the
   * banner. The previous version had two disconnected halves: useActionState held
   * a dispatch nobody called, while the form submitted through its own handler
   * that only handled success. So `state` stayed null forever — a failed invite
   * (duplicate address, revoked-then-reinvited, rate limit) showed NOTHING, and
   * `pending` never went true, so the button never disabled and a double-click
   * sent the invitation twice.
   */
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (_previous, formData) => {
      const result = await inviteUser({
        email: String(formData.get('email') ?? ''),
        // The schema is strict and `name` optional — omit it rather than send ''.
        name: String(formData.get('name') ?? '').trim() || undefined,
        roleIds: formData.getAll('roleIds').map(String),
      })

      if (result.ok) {
        // The list page never read `?invited=true`, so the redirect landed with
        // no confirmation. A toast is shown regardless of which page renders next.
        toast.success('Invitation sent')
        router.push('/admin/users')
      }

      return result
    },
    null,
  )

  return (
    <form action={formAction} className="space-y-4">
      {state && !state.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="email">Email Address</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="user@example.com"
          required
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="name">Name (optional)</Label>
        <Input
          id="name"
          name="name"
          placeholder="Full name"
          disabled={pending}
        />
      </div>

      <fieldset className="space-y-2">
        <Label>Roles</Label>
        {roles.length === 0 ? (
          <p className="text-sm text-gray-600">No roles available. Create roles first.</p>
        ) : (
          <div className="space-y-2">
            {roles.map((role) => (
              <label key={role.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="roleIds"
                  value={role.id}
                  disabled={pending}
                />
                <span className="text-sm">{role.name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || roles.length === 0}>
          {pending ? 'Sending invite...' : 'Send Invite'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.back()}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
