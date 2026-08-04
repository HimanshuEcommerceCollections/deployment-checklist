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
import { PERMISSIONS } from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Admin - User' }

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  INVITED: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  SUSPENDED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  DEACTIVATED: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.admin.access)

  /// A 404 covers both "no such user" and "not in this tenant" — confirming the
  /// difference would leak whether an id exists elsewhere.
  const user = await usersService.getUser(ctx, id).catch(() => null)
  if (!user) notFound()

  const [roles, granted, allProjects, projectRoles] = await Promise.all([
    rolesService.listRoles(ctx),
    membersService.listUserProjects(ctx, user.id),
    projectsService.listUserProjects(ctx),
    membersService.listAssignableRoles(ctx).catch(() => []),
  ])

  const isSelf = user.id === ctx.actorId
  const held = roles.filter((role) => user.roleIds.includes(role.id))
  const locked = user.lockedUntil && user.lockedUntil > new Date()

  /**
   * Whether any organization-wide role they hold already grants project access.
   *
   * This is the check that decides whether assigning projects restricts anything
   * at all: `projectScopeFor` short-circuits on a global grant and returns "every
   * project", so a user with `project.read` org-wide sees everything and their
   * assignments are decoration. The UI says so rather than letting an
   * administrator assign three projects and wonder why all four are visible.
   */
  const seesAllProjects = held.some(
    (role) => role.isSuperAdmin || role.permissions.includes(PERMISSIONS.project.read),
  )

  const assignedProjectIds = new Set(granted.map((entry) => entry.project.id))
  const availableProjects = allProjects
    .filter((project) => !assignedProjectIds.has(project.id))
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
              }}
              roles={roles.map((role) => ({
                id: role.id,
                name: role.name,
                key: role.key,
                isAssignableGlobally: role.isAssignableGlobally,
                isSuperAdmin: role.isSuperAdmin,
                grantsAllProjects: role.permissions.includes(PERMISSIONS.project.read),
              }))}
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
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
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
            granted={granted}
            available={availableProjects}
            roles={projectRoles}
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
