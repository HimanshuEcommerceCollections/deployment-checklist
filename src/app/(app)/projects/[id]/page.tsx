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
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Members</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{project.members.length}</p>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Environments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{project.environments.length}</p>
          </CardContent>
        </Card>
      </div>

      {project.environments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Environments</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {project.environments.map((env: any) => (
                <div key={env.id} className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: env.color }}
                  />
                  <span className="text-sm">{env.name}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {project.members.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Team Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {project.members.map((member: any) => (
                <div key={member.id} className="flex items-center justify-between py-2">
                  <span>{member.user.name}</span>
                  <span className="text-sm text-gray-600">{member.user.email}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
