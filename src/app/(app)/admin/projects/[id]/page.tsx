import { AdminProjectForm } from '@/features/admin/components/admin-project-form'
import { listAllProjects } from '@/features/admin/actions/admin-projects.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { notFound } from 'next/navigation'

export const metadata = { title: 'Edit Project' }

export default async function EditAdminProjectPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const projects = await listAllProjects()
  const project = projects.find((p: any) => p.id === params.id)

  if (!project) notFound()

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/projects">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Edit Project</h1>
      </div>

      <div className="rounded-lg border p-6">
        <AdminProjectForm project={project} />
      </div>
    </div>
  )
}
