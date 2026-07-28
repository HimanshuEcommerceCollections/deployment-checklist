import { ProjectsList } from '@/features/projects/components/projects-list'
import { listUserProjects } from '@/features/projects/actions/projects.actions'

export const metadata = { title: 'Projects' }

export default async function ProjectsPage() {
  const projects = await listUserProjects()

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Projects</h1>
      <ProjectsList projects={projects} />
    </div>
  )
}
