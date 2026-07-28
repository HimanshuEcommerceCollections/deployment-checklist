import { AdminProjectForm } from '@/features/admin/components/admin-project-form'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Create Project' }

export default function NewAdminProjectPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/projects">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Create Project</h1>
      </div>

      <div className="rounded-lg border p-6">
        <AdminProjectForm />
      </div>
    </div>
  )
}
