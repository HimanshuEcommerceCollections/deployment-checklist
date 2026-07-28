import { getUserProject } from '@/features/projects/actions/projects.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notFound } from 'next/navigation'

export const metadata = { title: 'Project Settings' }

export default async function ProjectSettingsPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  let project: any

  try {
    project = await getUserProject(params.id)
  } catch {
    notFound()
  }

  if (!project) notFound()

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href={`/projects/${params.id}`}>
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Project Settings</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>Update project information</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={`/api/projects/${params.id}/settings`} method="POST" className="space-y-4">
            <div>
              <Label htmlFor="name">Project Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={project.name}
                required
                maxLength={200}
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                name="description"
                defaultValue={project.description || ''}
                maxLength={2000}
                rows={4}
              />
            </div>

            <div>
              <Label htmlFor="color">Project Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="color"
                  name="color"
                  type="color"
                  defaultValue={project.color || '#3b82f6'}
                  className="h-10 w-20"
                />
                <span className="text-sm text-gray-600">{project.color}</span>
              </div>
            </div>

            <Button type="submit">Save Settings</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">Project ID</span>
            <span className="font-mono text-sm">{project.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Created</span>
            <span>{new Date(project.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Members</span>
            <span>{project.members?.length || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Deployments</span>
            <span>{project._count?.deployments || 0}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-200 bg-red-50">
        <CardHeader>
          <CardTitle className="text-red-900">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-red-700 mb-4">
            Deleting a project will move it to trash. It can be recovered from the admin trash for 30 days.
          </p>
          <form action={`/api/projects/${params.id}/delete`} method="POST">
            <Button type="submit" variant="destructive">
              Delete Project
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
