import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { NewDeploymentForm } from '@/features/deployments/components/new-deployment-form'
import { can, projectFilter, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'New Deployment' }

/**
 * Start a deployment run.
 *
 * Both "Start Deployment" and "New Deployment" have linked here since they were
 * written, to a route that did not exist — so the core loop was unreachable from
 * the UI even though the service behind it was complete.
 *
 * The options offered here are narrowed to what the service will actually accept,
 * rather than letting someone fill the form and be refused on submit:
 *
 *   • only PUBLISHED template versions — a draft has no frozen content to snapshot
 *   • only environments the project permits, when it restricts them
 *   • production environments only for an actor holding deployment.production
 *
 * That last one is the important one. `deployment.production` is checked in
 * addition to whatever else is being asked for on a production-flagged
 * environment, so an Engineer offered "Production" in a dropdown would fill the
 * whole form and then be told no.
 */
export default async function NewDeploymentPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.deployment.create)

  const project = await db.project.findFirst({
    where: {
      id: params.id,
      organizationId: ctx.organizationId,
      deletedAt: null,
      AND: [projectFilter(ctx, PERMISSIONS.deployment.create, 'id')],
    },
    select: { id: true, name: true, key: true, environmentIds: true },
  })

  if (!project) notFound()

  const [versions, allEnvironments] = await Promise.all([
    db.templateVersion.findMany({
      where: {
        status: 'PUBLISHED',
        deletedAt: null,
        template: { organizationId: ctx.organizationId, deletedAt: null, isActive: true },
      },
      select: {
        id: true,
        version: true,
        itemCount: true,
        sectionCount: true,
        template: { select: { name: true } },
      },
      orderBy: [{ templateId: 'asc' }, { version: 'desc' }],
    }),
    db.environment.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, key: true, name: true, isProduction: true },
      orderBy: { order: 'asc' },
    }),
  ])

  // An empty environmentIds means "no restriction" — matching the service, which
  // only enforces the list when it is non-empty.
  const permitted = allEnvironments
    .filter((e) => project.environmentIds.length === 0 || project.environmentIds.includes(e.id))
    .filter((e) => !e.isProduction || can(ctx, PERMISSIONS.deployment.production))

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/projects/${project.id}/deployments`}>
          <Button variant="ghost">← Back</Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">New Deployment</h1>
          <p className="text-sm text-gray-600">{project.name}</p>
        </div>
      </div>

      {versions.length === 0 || permitted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-gray-600">
          {versions.length === 0 ? (
            <p>
              No published checklist template yet. A draft cannot be deployed — publish a
              version first, under Administration → Templates.
            </p>
          ) : (
            <p>
              No environment is available to you for this project. Production environments
              require the “Deploy to production” permission.
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-lg border p-6">
          <NewDeploymentForm
            projectId={project.id}
            projectKey={project.key}
            versions={versions.map((v) => ({
              id: v.id,
              label: `${v.template.name} — v${v.version}`,
              detail: `${v.sectionCount} section(s), ${v.itemCount} item(s)`,
            }))}
            environments={permitted.map((e) => ({
              id: e.id,
              name: e.name,
              isProduction: e.isProduction,
            }))}
          />
        </div>
      )}
    </div>
  )
}
