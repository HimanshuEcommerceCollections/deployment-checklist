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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  addProjectMember,
  removeProjectMember,
  updateProjectMember,
} from '../actions/members.actions'

export interface AssignableRole {
  id: string
  name: string
  key: string
  isSuperAdmin: boolean
}

export interface ProjectMember {
  userId: string
  name: string
  email: string
  status: string
  roleIds: string[]
}

export interface AssignableUser {
  id: string
  name: string
  email: string
}

interface Props {
  projectId: string
  projectName: string
  members: ProjectMember[]
  /** Everyone in the organization who is not already assigned here. */
  candidates: AssignableUser[]
  roles: AssignableRole[]
  canManage: boolean
}

export function ProjectMembersManager({
  projectId,
  projectName,
  members,
  candidates,
  roles,
  canManage,
}: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ProjectMember | null>(null)
  const [revoking, setRevoking] = useState<ProjectMember | null>(null)

  const [userId, setUserId] = useState('')
  const [roleIds, setRoleIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setAdding(false)
    setEditing(null)
    setRevoking(null)
    setUserId('')
    setRoleIds([])
    setError(null)
  }

  function openAdd() {
    reset()
    setAdding(true)
  }

  function openEdit(member: ProjectMember) {
    reset()
    setEditing(member)
    setRoleIds(member.roleIds)
  }

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  function submitAdd() {
    if (!userId) return setError('Choose someone to assign.')
    if (roleIds.length === 0) return setError('Choose at least one role for them on this project.')

    startTransition(async () => {
      const result = await addProjectMember(projectId, { userId, roleIds })
      if (!result.ok) return setError(result.message)

      const who = candidates.find((c) => c.id === userId)
      toast.success(`${who?.name ?? 'User'} now has access to ${projectName}`)
      reset()
      router.refresh()
    })
  }

  function submitEdit() {
    if (!editing) return
    if (roleIds.length === 0) {
      // Clearing every role would leave a membership row granting nothing —
      // revoking is the honest way to express that.
      return setError('A member needs at least one role. Revoke access instead.')
    }

    startTransition(async () => {
      const result = await updateProjectMember(projectId, editing.userId, { roleIds })
      if (!result.ok) return setError(result.message)

      toast.success(`Updated ${editing.name}’s roles on ${projectName}`)
      reset()
      router.refresh()
    })
  }

  function submitRevoke() {
    if (!revoking) return

    startTransition(async () => {
      const result = await removeProjectMember(projectId, revoking.userId)
      if (!result.ok) return setError(result.message)

      toast.success(`${revoking.name} no longer has access to ${projectName}`)
      reset()
      router.refresh()
    })
  }

  const roleName = (id: string) => roles.find((r) => r.id === id)?.name ?? 'Unknown role'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length === 0
            ? 'Nobody is assigned to this project yet.'
            : `${members.length} ${members.length === 1 ? 'person has' : 'people have'} access.`}
        </p>
        {canManage && (
          <Button size="sm" onClick={openAdd} disabled={candidates.length === 0}>
            Assign someone
          </Button>
        )}
      </div>

      {members.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles on this project</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="font-mono text-sm">{member.email}</TableCell>
                  <TableCell className="space-x-1">
                    {member.roleIds.map((id) => (
                      <Badge key={id} variant="outline">
                        {roleName(id)}
                      </Badge>
                    ))}
                  </TableCell>
                  {canManage && (
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(member)}
                        disabled={pending}
                      >
                        Change roles
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => {
                          reset()
                          setRevoking(member)
                        }}
                        disabled={pending}
                      >
                        Revoke
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canManage && candidates.length === 0 && members.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Everyone in the organization is already assigned to this project.
        </p>
      )}

      {/* ── Assign ─────────────────────────────────────────────────────── */}
      <Dialog open={adding} onOpenChange={(next) => !pending && (next ? setAdding(true) : reset())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign someone to {projectName}</DialogTitle>
            <DialogDescription>
              They will see this project, and what they can do here comes from the roles you pick.
              This grants access to this project only.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label htmlFor="assign-user">Person</Label>
              <select
                id="assign-user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                disabled={pending}
                className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-50 dark:bg-input/30"
              >
                <option value="">Choose someone…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} — {candidate.email}
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

      {/* ── Change roles ───────────────────────────────────────────────── */}
      <Dialog
        open={editing !== null}
        onOpenChange={(next) => !pending && !next && reset()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing?.name} on {projectName}
            </DialogTitle>
            <DialogDescription>
              Changing roles takes effect on their next page load — permissions are resolved per
              request, not carried in their session.
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

      {/* ── Revoke ─────────────────────────────────────────────────────── */}
      <Dialog
        open={revoking !== null}
        onOpenChange={(next) => !pending && !next && reset()}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {revoking?.name}’s access to {projectName}?</DialogTitle>
            <DialogDescription>
              They lose sight of this project and its deployments on their next page load. Anything
              they already ticked stays on the record with their name on it.
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
  roles: AssignableRole[]
  selected: string[]
  onToggle: (id: string) => void
  disabled: boolean
}) {
  if (roles.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No role can be granted on a project. Mark at least one role as project-assignable under
        Roles.
      </p>
    )
  }

  return (
    <fieldset className="space-y-2">
      <Label>Roles on this project</Label>
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
