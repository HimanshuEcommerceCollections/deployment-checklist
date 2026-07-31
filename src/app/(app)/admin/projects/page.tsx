import { listAllProjects } from '@/features/admin/actions/admin-projects.actions'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Admin - Projects' }

export default async function AdminProjectsPage() {
  const projects = await listAllProjects()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          {/* Matches the sidebar label, which is "Manage Projects" to tell this
              apart from the /projects entry in the section above. */}
          <h1 className="text-3xl font-bold">Manage Projects</h1>
          <p className="text-muted-foreground">
            Every project in the organization, including ones you are not a member of.
          </p>
        </div>
        <Link href="/admin/projects/new">
          <Button>Create Project</Button>
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center space-y-4">
          <p className="text-gray-600">No projects yet.</p>
          <Link href="/admin/projects/new">
            <Button>Create First Project</Button>
          </Link>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Members</TableHead>
                <TableHead>Deployments</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project: any) => (
                <TableRow key={project.id}>
                  <TableCell className="font-medium">{project.name}</TableCell>
                  <TableCell>{project._count.memberships}</TableCell>
                  <TableCell>{project._count.deployments}</TableCell>
                  <TableCell>
                    <Link href={`/admin/projects/${project.id}`}>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
