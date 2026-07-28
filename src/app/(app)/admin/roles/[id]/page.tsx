import { RoleForm } from '@/features/admin/components/role-form'
import { listRoles } from '@/features/admin/actions/roles.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { notFound } from 'next/navigation'

export const metadata = { title: 'Edit Role' }

export default async function EditRolePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const roles = await listRoles()
  const role = roles.find((r: any) => r.id === params.id)

  if (!role) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/roles">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Edit Role</h1>
      </div>

      <div className="max-w-2xl rounded-lg border p-6">
        <RoleForm role={role} />
      </div>
    </div>
  )
}
