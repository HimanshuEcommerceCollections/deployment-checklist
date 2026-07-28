import { RoleForm } from '@/features/admin/components/role-form'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'New Role' }

export default function NewRolePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/roles">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Create Role</h1>
      </div>

      <div className="max-w-2xl rounded-lg border p-6">
        <RoleForm />
      </div>
    </div>
  )
}
