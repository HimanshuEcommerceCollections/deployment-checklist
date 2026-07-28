import { getRequestContext } from '@/server/context'
import { usersService } from '@/features/admin/server/users-service'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { UsersList } from '@/features/admin/components/users-list'

export const metadata = { title: 'User Management' }

export default async function UsersPage() {
  const ctx = await getRequestContext()
  const users = await usersService.listUsers(ctx)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="text-gray-600">Manage team members and their access</p>
        </div>
        <Link href="/admin/users/invite">
          <Button>Invite User</Button>
        </Link>
      </div>

      <UsersList users={users} />
    </div>
  )
}
