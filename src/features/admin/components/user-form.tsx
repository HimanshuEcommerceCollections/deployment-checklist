'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { updateUser } from '../actions/users.actions'
import { type PermissionRow, UserPermissionMatrix } from './user-permission-matrix'

export interface AssignableRole {
  id: string
  name: string
  key: string
  isSuperAdmin: boolean
  /** The permissions this role grants — the template an admin starts from. */
  permissions: string[]
}

interface UserFormProps {
  user: {
    id: string
    email: string
    name: string
    status: string
    roleIds: string[]
    extraPermissions: string[]
    revokedPermissions: string[]
  }
  roles: AssignableRole[]
  /** The catalog, already flattened for display. */
  permissions: PermissionRow[]
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

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key) => b.includes(key))

export function UserForm({ user, roles, permissions, isSelf }: UserFormProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [name, setName] = useState(user.name)
  const [status, setStatus] = useState(user.status)
  const [roleIds, setRoleIds] = useState<string[]>(user.roleIds)
  const [extra, setExtra] = useState<string[]>(user.extraPermissions)
  const [revoked, setRevoked] = useState<string[]>(user.revokedPermissions)
  const [error, setError] = useState<string | null>(null)

  /// INVITED is not offered: it is the state an account starts in and is left by
  /// accepting an invitation, not something an admin sets.
  const statusLocked = user.status === 'INVITED'

  /** What the currently ticked roles grant. Recomputed as roles are ticked. */
  const fromRoles = useMemo(() => {
    const set = new Set<string>()
    for (const role of roles) {
      if (!roleIds.includes(role.id)) continue
      for (const key of role.permissions) set.add(key)
    }
    return set
  }, [roles, roleIds])

  const dirty =
    name !== user.name ||
    status !== user.status ||
    !sameSet(roleIds, user.roleIds) ||
    !sameSet(extra, user.extraPermissions) ||
    !sameSet(revoked, user.revokedPermissions)

  /**
   * Ticking a role applies the specification's rule immediately, rather than saving
   * and letting the server surprise them: a removal only means "not this, even though
   * the role grants it", so a role that grants a revoked permission clears that
   * revocation. The server applies the same rule for any other caller.
   */
  function toggleRole(id: string) {
    const next = roleIds.includes(id) ? roleIds.filter((r) => r !== id) : [...roleIds, id]
    setRoleIds(next)

    if (!roleIds.includes(id)) {
      const added = roles.find((role) => role.id === id)
      if (added) setRevoked((prev) => prev.filter((key) => !added.permissions.includes(key)))
    }
  }

  /**
   * One checkbox, four transitions — which is what keeps `extra` and `revoked`
   * disjoint without asking the administrator to think about two lists:
   *
   *   role grants it, held      → revoke it
   *   role grants it, revoked   → drop the revocation
   *   added by hand             → drop the addition (not a revocation; no role grants it)
   *   nobody grants it          → add it
   */
  function togglePermission(key: string) {
    const roleGrants = fromRoles.has(key)

    if (revoked.includes(key)) {
      setRevoked((prev) => prev.filter((k) => k !== key))
      return
    }

    if (roleGrants) {
      setRevoked((prev) => [...prev, key])
      return
    }

    setExtra((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  function reset() {
    setName(user.name)
    setStatus(user.status)
    setRoleIds(user.roleIds)
    setExtra(user.extraPermissions)
    setRevoked(user.revokedPermissions)
    setError(null)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      const result = await updateUser(user.id, {
        name,
        status,
        roleIds,
        extraPermissions: extra,
        revokedPermissions: revoked,
      })

      if (!result.ok) {
        setError(result.message)
        return
      }

      toast.success(`${result.data.email} updated`)
      router.refresh()
    })
  }

  const heldCount = permissions.filter(
    (row) => !revoked.includes(row.key) && (fromRoles.has(row.key) || extra.includes(row.key)),
  ).length

  const superAdmin = roles.some((role) => roleIds.includes(role.id) && role.isSuperAdmin)
  const losingOwnAccess = isSelf && (status !== 'ACTIVE' || heldCount === 0)

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
            <Select value={status} onValueChange={setStatus} disabled={pending}>
              <SelectTrigger id="status" className="mt-1 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {STATUSES.find((s) => s.value === status)?.hint}
            </p>
          </>
        )}
      </div>

      <fieldset className="space-y-2">
        <Label>Roles</Label>
        <p className="text-xs text-muted-foreground">
          A role is a starting point. Ticking one grants its permissions below, and you can then
          add or remove individual permissions for this person.
        </p>

        {roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">No roles exist yet. Create one under Roles.</p>
        ) : (
          <div className="space-y-2">
            {roles.map((role) => (
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
                    <span className="ml-2 rounded bg-blocked-surface px-1.5 py-0.5 text-xs text-blocked">
                      full access
                    </span>
                  )}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{role.key}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {role.permissions.length} permission{role.permissions.length === 1 ? '' : 's'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3 border-t pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <Label>Permissions</Label>
          <span className="text-xs text-muted-foreground">
            {heldCount} of {permissions.length} held
          </span>
        </div>

        {superAdmin ? (
          <p className="rounded-lg border border-blocked/40 bg-blocked-surface p-3 text-sm">
            This user holds a <strong>full access</strong> role. Every permission applies regardless
            of what is ticked below, and it cannot be narrowed per person — remove that role first
            if you want to limit them.
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Un-ticking a permission a role grants records it as removed for this person; the role
              itself is unchanged. Assigning a role later that grants it will bring it back.
            </p>

            <UserPermissionMatrix
              rows={permissions}
              fromRoles={fromRoles}
              extra={extra}
              revoked={revoked}
              disabled={pending}
              onToggle={togglePermission}
            />
          </>
        )}
      </fieldset>

      {losingOwnAccess && (
        <div className="rounded-lg border border-hold/40 bg-hold-surface p-3 text-sm">
          This is your own account. Saving this will end your own access — you will be signed out
          on your next request.
        </div>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" disabled={pending || !dirty} onClick={reset}>
          Reset
        </Button>
      </div>
    </form>
  )
}
