import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAdminProject } from '@/features/admin/actions/admin-projects.actions'
import { AdminProjectForm } from '@/features/admin/components/admin-project-form'
import { ProjectMembersManager } from '@/features/projects/components/project-members-manager'
import { loadMembersPanelData } from '@/features/projects/server/members-panel-data'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Edit Project' }

export default async function EditAdminProjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params

  /// A single scoped read — this previously fetched every project and .find()'d.
  const project = await getAdminProject(params.id)
  if (!project) notFound()

  const ctx = await getRequestContext()
  const { canManage, members, candidates } = await loadMembersPanelData(ctx, project.id)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/projects">
          <Button variant="ghost">← Back</Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Edit Project</h1>
          <p className="text-sm text-muted-foreground">
            {project.name} · {project.key}
          </p>
        </div>
      </div>

      <div className="rounded-lg border p-6">
        <AdminProjectForm project={project} />
      </div>

      {/**
       * The same panel `/projects/[id]/members` mounts — one component, one data
       * assembly, so the two surfaces cannot drift. Hidden rather than disabled
       * when the actor lacks `project.members.manage`: reaching the admin area
       * does not by itself confer authority over who works on a project.
       */}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
            <CardDescription>
              Who can see and work on this project. What they can do here comes from the roles on
              their account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProjectMembersManager
              projectId={project.id}
              projectName={project.name}
              members={members}
              candidates={candidates}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
