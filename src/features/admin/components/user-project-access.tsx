'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
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
import {
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
} from '@/features/projects/actions/members.actions'

export interface GrantedProject {
  project: { id: string; name: string; key: string }
  roles: { id: string; name: string }[]
}

export interface AssignableProject {
  id: string
  name: string
  key: string
}

export interface ProjectRole {
  id: string
  name: string
  key: string
  isSuperAdmin: boolean
}

interface Props {
  userId: string
  userName: string
  granted: GrantedProject[]
  /** Projects this user is not already assigned to. */
  available: AssignableProject[]
  roles: ProjectRole[]
  /** True when this user already sees every project through an org-wide role. */
  seesAllProjects: boolean
}

/**
 * Project assignment, from the user's side.
 *
 * `Membership` is stored project-first, and `/projects/[id]/members` manages it
 * that way. An administrator asking "what should Sonika have access to?" is working
 * user-first, which is this — the same three service calls, the other way round.
 */
export function UserProjectAccess({
  userId,
  userName,
  granted,
  available,
  roles,
  seesAllProjects,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<GrantedProject | null>(null)
  const [revoking, setRevoking] = useState<GrantedProject | null>(null)

  const [projectId, setProjectId] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setAdding(false)
    setEditing(null)
    setRevoking(null)
    setProjectId('')
    setRoleIds([])
    setError(null)
  }

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  function submitAdd() {
    if (!projectId) return setError('Choose a project.')
    if (roleIds.length === 0) return setError('Choose at least one role on that project.')

    startTransition(async () => {
      const result = await addProjectMember(projectId, { userId, roleIds })
      if (!result.ok) return setError(result.message)

      const project = available.find((p) => p.id === projectId)
      toast.success(`${userName} now has access to ${project?.name ?? 'the project'}`)
      reset()
      router.refresh()
    })
  }

  function submitEdit() {
    if (!editing) return
    if (roleIds.length === 0) {
      return setError('At least one role is needed. Revoke the project instead.')
    }

    startTransition(async () => {
      const result = await updateProjectMember(editing.project.id, userId, { roleIds })
      if (!result.ok) return setError(result.message)

      toast.success(`Updated ${userName}’s roles on ${editing.project.name}`)
      reset()
      router.refresh()
    })
  }

  function submitRevoke() {
    if (!revoking) return

    startTransition(async () => {
      const result = await removeProjectMember(revoking.project.id, userId)
      if (!result.ok) return setError(result.message)

      toast.success(`${userName} no longer has access to ${revoking.project.name}`)
      reset()
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {seesAllProjects && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <p className="font-medium">This user can already see every project.</p>
          <p className="mt-1 text-muted-foreground">
            One of their organization-wide roles grants project access, which applies everywhere and
            overrides anything set here. To restrict them to specific projects, remove that role
            above and assign projects instead.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {granted.length === 0
            ? 'No projects assigned.'
            : `Assigned to ${granted.length} ${granted.length === 1 ? 'project' : 'projects'}.`}
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

      {granted.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {granted.map((entry) => (
            <li key={entry.project.id} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0">
                <p className="font-medium">{entry.project.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{entry.project.key}</p>
                <div className="mt-1 space-x-1">
                  {entry.roles.map((role) => (
                    <Badge key={role.id} variant="outline">
                      {role.name}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="shrink-0 space-x-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    reset()
                    setEditing(entry)
                    setRoleIds(entry.roles.map((r) => r.id))
                  }}
                >
                  Change roles
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  disabled={pending}
                  onClick={() => {
                    reset()
                    setRevoking(entry)
                  }}
                >
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {available.length === 0 && granted.length > 0 && (
        <p className="text-xs text-muted-foreground">
          They are assigned to every project in the organization.
        </p>
      )}

      <Dialog open={adding} onOpenChange={(next) => !pending && !next && reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign a project to {userName}</DialogTitle>
            <DialogDescription>
              They will see this project and nothing else changes about their other access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="assign-project">Project</Label>
              <select
                id="assign-project"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                disabled={pending}
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-50 dark:bg-input/30"
              >
                <option value="">Choose a project…</option>
                {available.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name} ({project.key})
                  </option>
                ))}
              </select>
            </div>

            <RolePicker roles={roles} selected={roleIds} onToggle={toggleRole} disabled={pending} />
          </div>

          {error && <FormError message={error} />}

          <DialogFooter>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submitAdd} disabled={pending}>
              {pending ? 'Assigning…' : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(next) => !pending && !next && reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {userName} on {editing?.project.name}
            </DialogTitle>
            <DialogDescription>
              Takes effect on their next page load — permissions resolve per request rather than
              being carried in their session.
            </DialogDescription>
          </DialogHeader>

          <RolePicker roles={roles} selected={roleIds} onToggle={toggleRole} disabled={pending} />

          {error && <FormError message={error} />}

          <DialogFooter>
            <Button variant="ghost" onClick={reset} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submitEdit} disabled={pending}>
              {pending ? 'Saving…' : 'Save roles'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoking !== null} onOpenChange={(next) => !pending && !next && reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Revoke {userName}’s access to {revoking?.project.name}?
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

function RolePicker({
  roles,
  selected,
  onToggle,
  disabled,
}: {
  roles: ProjectRole[]
  selected: string[]
  onToggle: (id: string) => void
  disabled: boolean
}) {
  if (roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No role can be granted on a project. Mark at least one as project-assignable under Roles.
      </p>
    )
  }

  return (
    <fieldset className="space-y-2">
      <Label>Roles on that project</Label>
      <div className="space-y-2">
        {roles.map((role) => (
          <label key={role.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={selected.includes(role.id)}
              onChange={() => onToggle(role.id)}
              disabled={disabled}
              className="mt-1"
            />
            <span className="text-sm">
              {role.name}
              {role.isSuperAdmin && (
                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
                  full access
                </span>
              )}
              <span className="ml-2 font-mono text-xs text-muted-foreground">{role.key}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function FormError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </div>
  )
}
