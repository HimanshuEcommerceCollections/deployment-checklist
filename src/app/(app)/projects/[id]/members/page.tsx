import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ProjectMembersManager } from '@/features/projects/components/project-members-manager'
import { membersService } from '@/features/projects/server/members-service'
import { projectsService } from '@/features/projects/server/projects-service'
import { can } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Project Access' }

/**
 * Who can work on this project.
 *
 * This was a read-only explainer stating that access is organisation-wide and
 * there was no membership to manage — the position docs/14 §14.5C took when it
 * removed the two buttons that 404'd. That decision is reversed: project
 * assignment is now the mechanism, so the buttons are real.
 *
 * The authorization half needed no work. `projectFilter` has always narrowed reads
 * to the projects where an actor holds the permission, so creating a Membership
 * here is what makes a project visible to someone, and revoking hides it again on
 * their next request.
 */
export default async function ProjectAccessPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const ctx = await getRequestContext()

  const project = await projectsService.getProject(ctx, params.id).catch(() => null)
  if (!project) notFound()

  const canManage = can(ctx, PERMISSIONS.project.membersManage, { projectId: project.id })

  const [members, roles] = await Promise.all([
    canManage ? membersService.listProjectMembers(ctx, project.id) : Promise.resolve([]),
    canManage ? membersService.listAssignableRoles(ctx) : Promise.resolve([]),
  ])

  const assignedIds = new Set(members.map((m) => m.user.id))

  /**
   * Candidates come straight from the tenant rather than through usersService,
   * which requires `user.read` — an actor may hold `project.members.manage` on one
   * project without being allowed to browse the whole organization's user list.
   */
  const candidates = canManage
    ? (
        await db.user.findMany({
          where: { organizationId: ctx.organizationId, deletedAt: null, status: 'ACTIVE' },
          select: { id: true, name: true, email: true },
          orderBy: { name: 'asc' },
        })
      ).filter((user) => !assignedIds.has(user.id))
    : []

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/projects/${project.id}`}>
          <Button variant="ghost">← Back</Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Project access</h1>
          <p className="text-sm text-muted-foreground">
            {project.name} · {project.key}
          </p>
        </div>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assigned people</CardTitle>
          </CardHeader>
          <CardContent>
            <ProjectMembersManager
              projectId={project.id}
              projectName={project.name}
              members={members.map((member) => ({
                userId: member.user.id,
                name: member.user.name,
                email: member.user.email,
                status: member.user.status,
                roleIds: member.roles.map((role) => role.id),
              }))}
              candidates={candidates}
              roles={roles}
              canManage
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You cannot manage access here</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Managing who can work on a project needs the{' '}
            <span className="font-mono text-xs">project.members.manage</span> permission, on this
            project or organization-wide.
          </CardContent>
        </Card>
      )}

      {/**
       * The distinction that decides whether assignment restricts anybody. An
       * org-wide role carrying `project.read` satisfies the permission everywhere,
       * so `projectFilter` returns every project and assignment becomes decoration.
       */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How access is decided</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Assigning someone here grants them <strong>this project only</strong>. The roles you
            give them decide what they can do on it — view, run a deployment, tick items, ship to
            production.
          </p>
          <p>
            Anyone holding an <strong>organization-wide</strong> role that includes project access
            already sees every project regardless of assignment, and will not appear above. That is
            set per user under Users.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
