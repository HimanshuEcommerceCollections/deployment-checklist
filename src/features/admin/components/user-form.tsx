'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { updateUser } from '../actions/users.actions'

export interface AssignableRole {
  id: string
  name: string
  key: string
  /** Project-scoped roles are granted through a membership, not here. */
  isAssignableGlobally: boolean
  isSuperAdmin: boolean
  /**
   * True when granting this role organization-wide makes every project visible.
   *
   * `projectScopeFor` short-circuits on a global grant, so this is the difference
   * between "assign them three projects" working and being decoration.
   */
  grantsAllProjects: boolean
}

interface UserFormProps {
  user: {
    id: string
    email: string
    name: string
    status: string
    roleIds: string[]
  }
  roles: AssignableRole[]
  /** True when this row is the signed-in actor — some choices become dangerous. */
  isSelf: boolean
}

const STATUSES = [
  { value: 'ACTIVE', label: 'Active', hint: 'Can sign in and use their roles.' },
  { value: 'SUSPENDED', label: 'Suspended', hint: 'Blocked from signing in. Reversible.' },
  {
    value: 'DEACTIVATED',
    label: 'Deactivated',
    hint: 'Blocked from signing in. Use for people who have left.',
  },
] as const

export function UserForm({ user, roles, isSelf }: UserFormProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(user.name)
  const [status, setStatus] = useState(user.status)
  const [roleIds, setRoleIds] = useState<string[]>(user.roleIds)
  const [error, setError] = useState<string | null>(null)

  /// INVITED is not offered: it is the state an account starts in and is left by
  /// accepting an invitation, not something an admin sets.
  const statusLocked = user.status === 'INVITED'

  const assignable = roles.filter((role) => role.isAssignableGlobally)
  const dirty =
    name !== user.name ||
    status !== user.status ||
    roleIds.length !== user.roleIds.length ||
    roleIds.some((id) => !user.roleIds.includes(id))

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await updateUser(user.id, { name, status, roleIds })

      if (!result.ok) {
        // The service's message is the useful one — the last-administrator refusal
        // and the project-scoped-role refusal each need different action.
        setError(result.message)
        return
      }

      toast.success(`${result.data.email} updated`)
      router.refresh()
    })
  }

  const losingOwnAccess = isSelf && (status !== 'ACTIVE' || roleIds.length === 0)

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div>
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="status">Status</Label>
        {statusLocked ? (
          <p className="mt-1 text-sm text-muted-foreground">
            This account is still <strong>invited</strong>. Its status is set by accepting the
            invitation — resend or revoke it below instead.
          </p>
        ) : (
          <>
            <select
              id="status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              disabled={pending}
              className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs disabled:opacity-50 dark:bg-input/30"
            >
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {STATUSES.find((s) => s.value === status)?.hint}
            </p>
          </>
        )}
      </div>

      <fieldset className="space-y-2">
        <Label>Organization-wide roles</Label>
        {assignable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No organization-wide roles exist yet. Create one under Roles.
          </p>
        ) : (
          <div className="space-y-2">
            {assignable.map((role) => (
              <label key={role.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={roleIds.includes(role.id)}
                  onChange={() => toggleRole(role.id)}
                  disabled={pending}
                  className="mt-1"
                />
                <span className="text-sm">
                  {role.name}
                  {role.isSuperAdmin && (
                    <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950 dark:text-red-300">
                      full access
                    </span>
                  )}
                  {!role.isSuperAdmin && role.grantsAllProjects && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                      all projects
                    </span>
                  )}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{role.key}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {assignable.some((role) => role.grantsAllProjects || role.isSuperAdmin) && (
          <p className="text-xs text-muted-foreground">
            A role marked <strong>all projects</strong> grants access to every project in the
            organization. To limit someone to specific projects, leave those unticked and use
            Project access below instead.
          </p>
        )}
        {roles.length !== assignable.length && (
          <p className="text-xs text-muted-foreground">
            Project-only roles are not listed here — grant those under Project access.
          </p>
        )}
      </fieldset>

      {losingOwnAccess && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          This is your own account. Saving this will end your own access — you will be signed out
          on your next request.
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending || !dirty}
          onClick={() => {
            setName(user.name)
            setStatus(user.status)
            setRoleIds(user.roleIds)
            setError(null)
          }}
        >
          Reset
        </Button>
      </div>
    </form>
  )
}
