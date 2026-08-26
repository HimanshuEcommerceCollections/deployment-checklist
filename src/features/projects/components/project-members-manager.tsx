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
import { SearchablePicker } from '@/components/searchable-picker'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { assignProject, revokeProject } from '../actions/members.actions'

export interface ProjectMember {
  userId: string
  name: string
  email: string
  /** The roles they hold on the user, shown for context — not editable here. */
  roleNames: string[]
}

export interface AssignableUser {
  id: string
  name: string
  email: string
  roleNames: string[]
}

interface Props {
  projectId: string
  projectName: string
  members: ProjectMember[]
  /** Everyone in the organization not already assigned here. */
  candidates: AssignableUser[]
}

/**
 * Assign and revoke, nothing else.
 *
 * There is no role picker: a person's roles live on their user record, and this
 * decides which projects those roles reach. An earlier version chose roles per
 * assignment; that let someone be Engineer here and Viewer there, at the cost of
 * two places to look for anyone's authority.
 */
export function ProjectMembersManager({ projectId, projectName, members, candidates }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [adding, setAdding] = useState(false)
  const [revoking, setRevoking] = useState<ProjectMember | null>(null)
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setAdding(false)
    setRevoking(null)
    setUserId('')
    setError(null)
  }

  function submitAssign() {
    if (!userId) return setError('Choose someone to assign.')

    startTransition(async () => {
      const result = await assignProject(projectId, { userId })
      if (!result.ok) return setError(result.message)

      const who = candidates.find((c) => c.id === userId)
      toast.success(`${who?.name ?? 'User'} now has access to ${projectName}`)
      reset()
      router.refresh()
    })
  }

  function submitRevoke() {
    if (!revoking) return

    startTransition(async () => {
      const result = await revokeProject(projectId, revoking.userId)
      if (!result.ok) return setError(result.message)

      toast.success(`${revoking.name} no longer has access to ${projectName}`)
      reset()
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {members.length === 0
            ? 'Nobody is assigned to this project yet.'
            : `${members.length} ${members.length === 1 ? 'person has' : 'people have'} access.`}
        </p>
        <Button
          size="sm"
          onClick={() => {
            reset()
            setAdding(true)
          }}
          disabled={candidates.length === 0 || pending}
        >
          Assign someone
        </Button>
      </div>

      {members.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Their roles</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell className="font-medium">{member.name}</TableCell>
                  <TableCell className="font-mono text-sm">{member.email}</TableCell>
                  <TableCell className="space-x-1">
                    {member.roleNames.length > 0 ? (
                      member.roleNames.map((name) => (
                        <Badge key={name} variant="outline">
                          {name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        no roles — assignment alone grants nothing
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={pending}
                      onClick={() => {
                        reset()
                        setRevoking(member)
                      }}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Roles are set on each person under Users. Assigning them here decides which projects those
        roles apply to — change what someone can do by changing their roles, not their assignments.
      </p>

      <Dialog open={adding} onOpenChange={(next) => !pending && !next && reset()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign someone to {projectName}</DialogTitle>
            <DialogDescription>
              They will see this project, and what they can do here comes from the roles already on
              their account.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label htmlFor="assign-user">Person</Label>
            <div className="mt-1">
              {/* keyed on the dialog so the search resets each time it opens */}
              <SearchablePicker
                key={adding ? 'open' : 'closed'}
                inputId="assign-user"
                options={candidates.map((candidate) => ({
                  id: candidate.id,
                  primary: candidate.name,
                  secondary: candidate.email,
                  hint: candidate.roleNames.length > 0 ? candidate.roleNames.join(', ') : 'no roles',
                }))}
                value={userId}
                onSelect={setUserId}
                placeholder="Search by name or email…"
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
              Revoke {revoking?.name}’s access to {projectName}?
            </DialogTitle>
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

function FormError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </div>
  )
}
