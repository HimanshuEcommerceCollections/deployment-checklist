'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { Environment } from '@prisma/client'
import { createEnvironment, updateEnvironment } from '../actions/environments.actions'

interface EnvironmentFormProps {
  environment?: Environment
}

export function EnvironmentForm({ environment }: EnvironmentFormProps) {
  const router = useRouter()
  const isCreate = !environment

  const formAction = isCreate
    ? async (_: any, formData: FormData) => {
        const result = await createEnvironment({
          name: formData.get('name'),
          key: formData.get('key'),
          color: formData.get('color'),
          isProduction: formData.get('isProduction') === 'on',
          order: formData.get('order'),
        })
        if (result.ok) {
          toast.success('Environment created')
          router.push('/admin/environments')
          router.refresh()
        }
        return result
      }
    : async (_: any, formData: FormData) => {
        const result = await updateEnvironment(environment!.id, {
          name: formData.get('name'),
          key: formData.get('key'),
          color: formData.get('color'),
          isProduction: formData.get('isProduction') === 'on',
          order: formData.get('order'),
        })
        if (result.ok) {
          toast.success('Environment updated')
          router.push('/admin/environments')
          router.refresh()
        }
        return result
      }

  const [state, action, pending] = useActionState(formAction, null)

  return (
    <form action={action} className="space-y-4">
      {!state?.ok && state && (
        <div className="rounded-lg border border-blocked/40 bg-blocked-surface p-4 text-sm text-blocked">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="name">Environment Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={environment?.name}
          required
          maxLength={50}
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="key">Key (lowercase, no spaces)</Label>
        <Input
          id="key"
          name="key"
          defaultValue={environment?.key}
          required
          maxLength={30}
          pattern="^[a-z0-9_]+$"
          disabled={pending}
        />
      </div>

      <div className="flex gap-4">
        <div className="flex-1">
          <Label htmlFor="color">Color</Label>
          <div className="flex items-center gap-2">
            <Input
              id="color"
              name="color"
              type="color"
              defaultValue={environment?.color}
              disabled={pending}
              className="h-10 w-20"
            />
            <span className="text-sm text-muted-foreground">{environment?.color}</span>
          </div>
        </div>

        <div className="flex-1">
          <Label htmlFor="order">Display Order</Label>
          <Input
            id="order"
            name="order"
            type="number"
            defaultValue={environment?.order}
            disabled={pending}
          />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="isProduction"
          defaultChecked={environment?.isProduction}
          disabled={pending}
        />
        <span className="text-sm">Production environment</span>
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
