import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getUserProject } from '@/features/projects/actions/projects.actions'
import {
  DeleteProjectButton,
  ProjectSettingsForm,
} from '@/features/projects/components/project-settings-form'

export const metadata = { title: 'Project Settings' }

export default async function ProjectSettingsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  let project

  try {
    project = await getUserProject(params.id)
  } catch {
    notFound()
  }

  if (!project) notFound()

  return (
    <div className="max-w-2xl space-y-6">
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
          <ProjectSettingsForm
            projectId={project.id}
            name={project.name}
            description={project.description ?? null}
            color={project.color ?? null}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Project Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Project ID</span>
            <span className="font-mono text-sm">{project.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Created</span>
            <span>{new Date(project.createdAt).toLocaleDateString('en-GB')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Members</span>
            <span>{project.memberships?.length || 0}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deployments</span>
            <span>{project._count?.deployments || 0}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-blocked/40 bg-blocked-surface">
        <CardHeader>
          <CardTitle className="text-blocked">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-blocked">
            Deleting a project will move it to trash. It can be recovered from the admin trash for
            30 days.
          </p>
          <DeleteProjectButton projectId={project.id} name={project.name} />
        </CardContent>
      </Card>
    </div>
  )
}
