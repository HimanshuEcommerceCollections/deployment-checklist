'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { inviteUser } from '../actions/users.actions'

interface Role {
  id: string
  name: string
  key: string
}

interface InviteUserFormProps {
  roles: Role[]
}

export function InviteUserForm({ roles }: InviteUserFormProps) {
  const router = useRouter()
  const [state, , pending] = useActionState(inviteUser, null)

  const handleSubmit = async (formData: FormData) => {
    const email = formData.get('email')
    const name = formData.get('name')
    const selectedRoles = formData.getAll('roleIds')

    const result = await inviteUser({
      email,
      name: name || undefined,
      roleIds: selectedRoles,
    })

    if (result.ok) {
      router.push('/admin/users?invited=true')
    }
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {!state?.ok && state && (
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
          onClick={() => window.history.back()}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
