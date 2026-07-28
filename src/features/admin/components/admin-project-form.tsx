'use client'

import { useActionState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { Project } from '@prisma/client'
import { createAdminProject, updateAdminProject } from '../actions/admin-projects.actions'

interface AdminProjectFormProps {
  project?: Project
}

export function AdminProjectForm({ project }: AdminProjectFormProps) {
  const router = useRouter()
  const isCreate = !project

  const formAction = isCreate
    ? async (_: any, formData: FormData) => {
        const result = await createAdminProject({
          name: formData.get('name'),
          description: formData.get('description'),
          color: formData.get('color'),
        })
        if (result.ok) router.push('/admin/projects')
        return result
      }
    : async (_: any, formData: FormData) => {
        const result = await updateAdminProject(project!.id, {
          name: formData.get('name'),
          description: formData.get('description'),
          color: formData.get('color'),
        })
        if (result.ok) router.push('/admin/projects')
        return result
      }

  const [state, action, pending] = useActionState(formAction, null)

  return (
    <form action={action} className="space-y-6">
      {!state?.ok && state && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="name">Project Name</Label>
        <Input
          id="name"
          name="name"
          defaultValue={project?.name}
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
          defaultValue={project?.description || ''}
          maxLength={2000}
          disabled={pending}
          rows={4}
        />
      </div>

      <div>
        <Label htmlFor="color">Project Color</Label>
        <div className="flex items-center gap-3">
          <Input
            id="color"
            name="color"
            type="color"
            defaultValue={project?.color || '#3b82f6'}
            disabled={pending}
            className="h-10 w-20"
          />
          <span className="text-sm text-gray-600">{project?.color || '#3b82f6'}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving...' : isCreate ? 'Create Project' : 'Update Project'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
