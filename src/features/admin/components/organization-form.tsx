'use client'

import { useActionState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateOrganization } from '../actions/organization.actions'

interface OrganizationFormProps {
  organization: { name: string; slug: string }
}

export function OrganizationForm({ organization }: OrganizationFormProps) {
  const [state, action, pending] = useActionState(
    async (_: unknown, formData: FormData) =>
      updateOrganization({
        name: formData.get('name') as string,
        slug: formData.get('slug') as string,
      }),
    null,
  )

  return (
    <form action={action} className="space-y-4">
      {state && (
        <div
          className={
            state.ok
              ? 'rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800'
              : 'rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800'
          }
        >
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="name">Organization Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={organization.name}
          required
          maxLength={200}
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="slug">Slug</Label>
        <Input
          id="slug"
          name="slug"
          defaultValue={organization.slug}
          required
          maxLength={60}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          disabled={pending}
        />
        <p className="mt-1 text-xs text-gray-500">
          Lowercase letters, numbers and hyphens. Identifies your organization.
        </p>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving...' : 'Save Changes'}
      </Button>
    </form>
  )
}
