'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Role } from '@prisma/client'
import { createRole, updateRole } from '../actions/roles.actions'
import { ALL_PERMISSIONS } from '@/lib/authz/permissions'

interface RoleFormProps {
  role?: Role
}

export function RoleForm({ role }: RoleFormProps) {
  const router = useRouter()
  const isCreate = !role

  const formAction = isCreate
    ? async (_: any, formData: FormData) => {
        const permissions = Array.from(formData.getAll('permissions'))
        const result = await createRole({
          name: formData.get('name'),
          key: formData.get('key'),
          description: formData.get('description'),
          permissions,
          isAssignableGlobally: formData.get('isAssignableGlobally') === 'on',
        })
        if (result.ok) router.push('/admin/roles')
        return result
      }
    : async (_: any, formData: FormData) => {
        const permissions = Array.from(formData.getAll('permissions'))
        const result = await updateRole(role!.id, {
          name: formData.get('name'),
          key: formData.get('key'),
          description: formData.get('description'),
          permissions,
          isAssignableGlobally: formData.get('isAssignableGlobally') === 'on',
        })
        if (result.ok) router.push('/admin/roles')
        return result
      }

  const [state, action, pending] = useActionState(formAction, null)

  return (
    <form action={action} className="space-y-6">
      {!state?.ok && state && (
        <div className="rounded-lg border border-blocked/40 bg-blocked-surface p-4 text-sm text-blocked">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="name">Role Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={role?.name}
          required
          maxLength={100}
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="key">Key (lowercase, underscores)</Label>
        <Input
          id="key"
          name="key"
          defaultValue={role?.key}
          required
          maxLength={50}
          pattern="^[a-z0-9_]+$"
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={role?.description || ''}
          maxLength={500}
          disabled={pending}
        />
      </div>

      <fieldset className="border-t pt-6">
        <legend className="font-medium">Permissions</legend>
        <div className="mt-4 grid max-h-60 grid-cols-2 gap-3 overflow-y-auto">
          {ALL_PERMISSIONS.map((perm) => (
            <label key={perm} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="permissions"
                value={perm}
                defaultChecked={role?.permissions.includes(perm)}
                disabled={pending}
              />
              <span className="text-sm">{perm}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="isAssignableGlobally"
          defaultChecked={role?.isAssignableGlobally}
          disabled={pending}
        />
        <span className="text-sm">Assignable globally (not project-scoped)</span>
      </label>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : isCreate ? 'Create' : 'Update'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
