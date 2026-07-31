import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { UsersList } from '@/features/admin/components/users-list'
import { rolesService } from '@/features/admin/server/roles-service'
import { usersService } from '@/features/admin/server/users-service'
import { requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'User Management' }

export default async function UsersPage() {
  const ctx = await getRequestContext()

  /// The navigation is generated from permissions so this never appears in the
  /// menu without them — but the route is still reachable by typing the URL, and
  /// it lists every account in the organization.
  requirePermission(ctx, PERMISSIONS.admin.access)

  /// Names only. The list labels roles and nothing more, and whole role rows would
  /// put every permission array in the page's flight payload.
  const [users, roleNames] = await Promise.all([
    usersService.listUsers(ctx),
    rolesService.roleNames(ctx),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-muted-foreground">Manage team members and their access</p>
        </div>
        <Link href="/admin/users/invite">
          <Button>Invite User</Button>
        </Link>
      </div>

      <UsersList users={users} roleNames={roleNames} />
    </div>
  )
}
