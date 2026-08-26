'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { ChecklistTemplate } from '@prisma/client'
import { createTemplate, updateTemplate } from '../actions/templates.actions'

interface TemplateFormProps {
  template?: ChecklistTemplate
}

export function TemplateForm({ template }: TemplateFormProps) {
  const router = useRouter()
  const isCreate = !template

  const formAction = isCreate
    ? async (_: any, formData: FormData) => {
        const result = await createTemplate({
          name: formData.get('name'),
          description: formData.get('description'),
        })
        if (result.ok) {
          toast.success('Template created')
          router.push('/admin/templates')
          router.refresh()
        }
        return result
      }
    : async (_: any, formData: FormData) => {
        const result = await updateTemplate(template!.id, {
          name: formData.get('name'),
          description: formData.get('description'),
        })
        if (result.ok) {
          toast.success('Template updated')
          router.push('/admin/templates')
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
        <Label htmlFor="name">Template Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={template?.name}
          required
          maxLength={200}
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={template?.description || ''}
          maxLength={2000}
          disabled={pending}
        />
      </div>

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
