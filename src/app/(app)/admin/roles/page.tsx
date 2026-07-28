import { RolesList } from '@/features/admin/components/roles-list'
import { listRoles } from '@/features/admin/actions/roles.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Roles' }

export default async function RolesPage() {
  const roles = await listRoles()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Roles</h1>
        <Link href="/admin/roles/new">
          <Button>Create Role</Button>
        </Link>
      </div>

      <RolesList roles={roles} />
    </div>
  )
}
