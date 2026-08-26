'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  deleteAdminProject,
  updateAdminProject,
} from '@/features/admin/actions/admin-projects.actions'

interface Props {
  projectId: string
  name: string
  description: string | null
  color: string | null
}

type State = { error: string | null }

/**
 * The general-settings form and the Danger Zone, both previously wired to API
 * routes that do not exist (`/api/projects/[id]/settings` and `/delete`) — Save
 * navigated to a 404 and Delete did the same, with no confirmation. Both now go
 * through the real server actions; deleting requires typing the project name.
 */
export function ProjectSettingsForm({ projectId, name, description, color }: Props) {
  const router = useRouter()
  const [colorValue, setColorValue] = useState(color || '#3b82f6')

  const [state, action, pending] = useActionState<State, FormData>(async (_previous, formData) => {
    const result = await updateAdminProject(projectId, {
      name: String(formData.get('name') ?? '').trim(),
      description: String(formData.get('description') ?? '').trim() || undefined,
      color: String(formData.get('color') ?? '') || undefined,
    })
    if (!result.ok) return { error: result.message }

    toast.success('Project settings saved')
    router.refresh()
    return { error: null }
  }, { error: null })

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div role="alert" className="rounded-lg border border-blocked/40 bg-blocked-surface px-3 py-2 text-sm text-blocked">
          {state.error}
        </div>
      )}

      <div>
        <Label htmlFor="name">Project Name</Label>
        <Input id="name" name="name" defaultValue={name} required maxLength={200} disabled={pending} />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          defaultValue={description || ''}
          maxLength={2000}
          rows={4}
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="color">Project Color</Label>
        <div className="flex items-center gap-2">
          <Input
            id="color"
            name="color"
            type="color"
            value={colorValue}
            onChange={(event) => setColorValue(event.target.value)}
            className="h-10 w-20"
            disabled={pending}
          />
          <span className="font-mono text-sm text-muted-foreground">{colorValue}</span>
        </div>
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Save Settings'}
      </Button>
    </form>
  )
}

/**
 * Deleting a project trashes it with every deployment record inside — the kind
 * of action that must not be one accidental click. The dialog requires typing
 * the project's name before the button arms.
 */
export function DeleteProjectButton({ projectId, name }: { projectId: string; name: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [pending, startTransition] = useTransition()

  function remove() {
    startTransition(async () => {
      const result = await deleteAdminProject(projectId)
      if (!result.ok) {
        toast.error(result.message)
        setOpen(false)
        return
      }
      toast.success(`${name} moved to trash`)
      router.push('/projects')
      router.refresh()
    })
  }

  return (
    <>
      <Button variant="destructive" onClick={() => { setTyped(''); setOpen(true) }}>
        Delete Project
      </Button>

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete ${name}?`}
        description="The project and its deployment records move to the trash. An administrator can restore it from there for 30 days; after that it is gone."
        confirmLabel="Delete project"
        pendingLabel="Deleting…"
        destructive
        pending={pending}
        confirmDisabled={typed.trim() !== name}
        onConfirm={remove}
      >
        <div>
          <Label htmlFor="confirm-project-name">
            Type <span className="font-mono font-semibold">{name}</span> to confirm
          </Label>
          <Input
            id="confirm-project-name"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            disabled={pending}
            autoComplete="off"
            className="mt-1"
          />
        </div>
      </ConfirmDialog>
    </>
  )
}
