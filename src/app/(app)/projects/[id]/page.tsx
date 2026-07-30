import { getUserProject } from '@/features/projects/actions/projects.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Project' }

export default async function ProjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  let project: any
  try {
    project = await getUserProject(params.id)
  } catch {
    notFound()
  }

  if (!project) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="ghost">← Back</Button>
          </Link>
          <h1 className="text-3xl font-bold">{project.name}</h1>
          {project.color && (
            <div
              className="h-8 w-8 rounded-md"
              style={{ backgroundColor: project.color }}
            />
          )}
        </div>
        <Link href={`/projects/${project.id}/deployments/new`}>
          <Button>Start Deployment</Button>
        </Link>
      </div>

      {project.description && (
        <p className="text-gray-600">{project.description}</p>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {/* Access is org-wide: it comes from the actor's role, not from a
            per-project membership. A "Members: 0" tile would read as "nobody has
            access" when in fact everyone with the permission does. See docs/14. */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Access</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">Org-wide</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Deployments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{project._count.deployments}</p>
          </CardContent>
        </Card>

      </div>


      {project.memberships && project.memberships.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {project.memberships.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between py-2">
                  <span>{member.user?.name}</span>
                  <span className="text-sm text-gray-600">{member.user?.email}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
