import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DeleteUserButton } from '@/features/admin/components/delete-user-button'
import { UserForm } from '@/features/admin/components/user-form'
import { UserInvitationPanel } from '@/features/admin/components/user-invitation-panel'
import { UserProjectAccess } from '@/features/admin/components/user-project-access'
import { rolesService } from '@/features/admin/server/roles-service'
import { usersService } from '@/features/admin/server/users-service'
import { membersService } from '@/features/projects/server/members-service'
import { projectsService } from '@/features/projects/server/projects-service'
import { requirePermission } from '@/lib/authz/authorize'
import {
  PERMISSION_DEFINITIONS,
  PERMISSION_GROUPS,
  PERMISSIONS,
} from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Admin - User' }

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-go-surface text-go',
  INVITED: 'bg-cyan/10 text-cyan',
  SUSPENDED: 'bg-hold-surface text-hold',
  DEACTIVATED: 'bg-muted text-foreground',
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.admin.access)

  /// A 404 covers both "no such user" and "not in this tenant" — confirming the
  /// difference would leak whether an id exists elsewhere.
  const user = await usersService.getUser(ctx, id).catch(() => null)
  if (!user) notFound()

  const [roles, assigned, allProjects] = await Promise.all([
    rolesService.listRoles(ctx),
    membersService.listUserProjects(ctx, user.id),
    projectsService.listUserProjects(ctx),
  ])

  const isSelf = user.id === ctx.actorId
  const held = roles.filter((role) => user.roleIds.includes(role.id))
  const locked = user.lockedUntil && user.lockedUntil > new Date()

  /**
   * Whether a role they hold carries organization-wide authority over projects.
   *
   * Only super-admin can now do this: `resolvePermissions` puts project-scoped
   * permissions on assigned projects rather than in the global set, so an ordinary
   * role no longer grants access everywhere. The wildcard is the exception, and
   * `can()` short-circuits on it before any scope is consulted.
   */
  const seesAllProjects = held.some((role) => role.isSuperAdmin)

  /**
   * The catalog, flattened for display. Built here rather than imported by the
   * client component so the permission definitions stay server-side and only the
   * fields the matrix renders cross the boundary.
   */
  const permissionRows = PERMISSION_DEFINITIONS.map((definition) => ({
    key: definition.key,
    label: definition.label,
    description: definition.description,
    group: definition.group,
    groupLabel: PERMISSION_GROUPS[definition.group],
    dangerous: Boolean(definition.dangerous),
    orgWide: Boolean(definition.globalOnly),
  }))

  const assignedIds = new Set(assigned.map((entry) => entry.project.id))
  const availableProjects = allProjects
    .filter((project) => !assignedIds.has(project.id))
    .map((project) => ({ id: project.id, name: project.name, key: project.key }))

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/users">
          <Button variant="ghost" className="mb-2">
            ← Back to users
          </Button>
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">{user.name}</h1>
          <Badge className={STATUS_STYLE[user.status] ?? STATUS_STYLE.DEACTIVATED}>
            {user.status}
          </Badge>
          {isSelf && <Badge variant="outline">You</Badge>}
        </div>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{user.email}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Access</CardTitle>
          </CardHeader>
          <CardContent>
            <UserForm
              user={{
                id: user.id,
                email: user.email,
                name: user.name,
                status: user.status,
                roleIds: user.roleIds,
                extraPermissions: user.extraPermissions,
                revokedPermissions: user.revokedPermissions,
              }}
              roles={roles.map((role) => ({
                id: role.id,
                name: role.name,
                key: role.key,
                isSuperAdmin: role.isSuperAdmin,
                permissions: role.permissions,
              }))}
              permissions={permissionRows}
              isSelf={isSelf}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">Joined</dt>
                <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last sign-in</dt>
                <dd>
                  {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Password changed</dt>
                <dd>
                  {user.passwordChangedAt
                    ? new Date(user.passwordChangedAt).toLocaleDateString()
                    : 'Never'}
                </dd>
              </div>
              {user.jobTitle && (
                <div>
                  <dt className="text-muted-foreground">Job title</dt>
                  <dd>{user.jobTitle}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Current roles</dt>
                <dd>{held.length > 0 ? held.map((r) => r.name).join(', ') : 'None'}</dd>
              </div>
              {locked && (
                <div className="rounded-lg border border-hold/40 bg-hold-surface p-2 text-xs">
                  Locked out after {user.failedLoginCount} failed attempts, until{' '}
                  {new Date(user.lockedUntil!).toLocaleString()}. Setting the status to Active
                  clears it.
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project access</CardTitle>
        </CardHeader>
        <CardContent>
          <UserProjectAccess
            userId={user.id}
            userName={user.name}
            assigned={assigned.map((entry) => entry.project)}
            available={availableProjects}
            roleNames={held.map((role) => role.name)}
            seesAllProjects={seesAllProjects}
          />
        </CardContent>
      </Card>

      {user.invitation && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invitation</CardTitle>
          </CardHeader>
          <CardContent>
            <UserInvitationPanel
              userId={user.id}
              email={user.email}
              invitation={{
                expiresAt: user.invitation.expiresAt.toISOString(),
                sentCount: user.invitation.sentCount,
                lastSentAt: user.invitation.lastSentAt?.toISOString() ?? null,
              }}
            />
          </CardContent>
        </Card>
      )}

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Delete this account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            Ends their sessions immediately and removes their access. Recoverable from Trash.
          </p>
          <DeleteUserButton userId={user.id} email={user.email} isSelf={isSelf} />
        </CardContent>
      </Card>
    </div>
  )
}
