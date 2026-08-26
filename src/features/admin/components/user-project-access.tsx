'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { SearchablePicker } from '@/components/searchable-picker'
import { assignProject, revokeProject } from '@/features/projects/actions/members.actions'

export interface AssignedProject {
  id: string
  name: string
  key: string
}

interface Props {
  userId: string
  userName: string
  assigned: AssignedProject[]
  /** Projects this user is not assigned to yet. */
  available: AssignedProject[]
  /** Names of the roles on their account, for the "assignment grants nothing" case. */
  roleNames: string[]
  /** True when a role they hold is organization-wide and already covers everything. */
  seesAllProjects: boolean
}

/**
 * Which projects this person's roles apply to.
 *
 * No role picker: roles are set once, above, and this is where they reach. Membership
 * is stored project-first and `/projects/[id]/members` manages it that way; an
 * administrator asking "what should Sonika have?" works user-first, which is this.
 */
export function UserProjectAccess({
  userId,
  userName,
  assigned,
  available,
  roleNames,
  seesAllProjects,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [adding, setAdding] = useState(false)
  const [revoking, setRevoking] = useState<AssignedProject | null>(null)
  const [projectId, setProjectId] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setAdding(false)
    setRevoking(null)
    setProjectId('')
    setError(null)
  }

  function submitAssign() {
    if (!projectId) return setError('Choose a project.')

    startTransition(async () => {
      const result = await assignProject(projectId, { userId })
      if (!result.ok) return setError(result.message)

      const project = available.find((p) => p.id === projectId)
      toast.success(`${userName} now has access to ${project?.name ?? 'the project'}`)
      reset()
      router.refresh()
    })
  }

  function submitRevoke() {
    if (!revoking) return

    startTransition(async () => {
      const result = await revokeProject(revoking.id, userId)
      if (!result.ok) return setError(result.message)

      toast.success(`${userName} no longer has access to ${revoking.name}`)
      reset()
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {seesAllProjects && (
        <div className="rounded-lg border border-hold/40 bg-hold-surface p-3 text-sm">
          <p className="font-medium">This user can already see every project.</p>
          <p className="mt-1 text-muted-foreground">
            One of their roles carries organization-wide authority, which applies everywhere and
            overrides anything set here.
          </p>
        </div>
      )}

      {roleNames.length === 0 && !seesAllProjects && (
        <div className="rounded-lg border border-hold/40 bg-hold-surface p-3 text-sm">
          <p className="font-medium">This user has no roles.</p>
          <p className="mt-1 text-muted-foreground">
            Assigning projects grants nothing on its own — the roles above decide what they can do,
            and assignment decides where. Give them a role first.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {assigned.length === 0
            ? 'No projects assigned.'
            : `Assigned to ${assigned.length} ${assigned.length === 1 ? 'project' : 'projects'}.`}
        </p>
        <Button
          size="sm"
          onClick={() => {
            reset()
            setAdding(true)
          }}
          disabled={available.length === 0 || pending}
        >
          Assign a project
        </Button>
      </div>

      {assigned.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {assigned.map((project) => (
            <li key={project.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="font-medium">{project.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{project.key}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-destructive"
                disabled={pending}
                onClick={() => {
                  reset()
                  setRevoking(project)
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length === 0 && assigned.length > 0 && (
        <p className="text-xs text-muted-foreground">
          They are assigned to every project in the organization.
        </p>
      )}

      {roleNames.length > 0 && (
        <p className="text-xs text-muted-foreground">
          On each assigned project they act as: {roleNames.join(', ')}.
        </p>
      )}

      <Dialog open={adding} onOpenChange={(next) => !pending && !next && reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign a project to {userName}</DialogTitle>
            <DialogDescription>
              Their existing roles will apply on this project. Nothing else about their access
              changes.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="assign-project">Project</Label>
            <div className="mt-1">
              {/* keyed on the dialog so the search resets each time it opens */}
              <SearchablePicker
                key={adding ? 'open' : 'closed'}
                inputId="assign-project"
                options={available.map((project) => ({
                  id: project.id,
                  primary: project.name,
                  secondary: project.key,
                }))}
                value={projectId}
                onSelect={setProjectId}
                placeholder="Search projects by name or key…"
                disabled={pending}
              />
            </div>
          </div>

          {error && <FormError message={error} />}

          <DialogFooter>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submitAssign} disabled={pending}>
              {pending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(next) => !pending && !next && reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revoke {userName}’s access to {revoking?.name}?
            </DialogTitle>
            <DialogDescription>
              They lose sight of the project and its deployments on their next page load. Checklist
              items they ticked stay on the record with their name on them.
            </DialogDescription>
          </DialogHeader>

          {error && <FormError message={error} />}

          <DialogFooter>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitRevoke} disabled={pending}>
              {pending ? 'Revoking…' : 'Revoke access'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FormError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </div>
  )
}
