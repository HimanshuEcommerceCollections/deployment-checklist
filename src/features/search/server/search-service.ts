import 'server-only'

import { type RequestContext, canOnAnyProject, projectFilter } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

export interface SearchHit {
  id: string
  type: 'deployment' | 'project'
  title: string
  description: string
  path: string
}

/**
 * Cross-entity search, scoped to what the actor may actually see.
 *
 * This replaced a page that returned two hardcoded rows linking to `/projects/1`
 * — confident-looking results that always 404'd. Every query here is narrowed by
 * `projectFilter`, so a user only ever finds deployments and projects in the
 * projects they are assigned to, and results link to ids that exist.
 */
export class SearchService {
  async search(ctx: RequestContext, rawQuery: string): Promise<SearchHit[]> {
    const query = rawQuery.trim()
    if (query.length < 2) return []

    const canReadDeployments = canOnAnyProject(ctx, PERMISSIONS.deployment.read)
    const canReadProjects = canOnAnyProject(ctx, PERMISSIONS.project.read)

    const [deployments, projects] = await Promise.all([
      canReadDeployments
        ? db.deploymentRun.findMany({
            where: {
              ...projectFilter(ctx, PERMISSIONS.deployment.read),
              project: { organizationId: ctx.organizationId },
              deletedAt: null,
              searchText: { contains: query.toLowerCase() },
            },
            select: {
              id: true,
              projectId: true,
              reference: true,
              title: true,
              version: true,
              environmentName: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
          })
        : Promise.resolve([]),
      canReadProjects
        ? db.project.findMany({
            where: {
              ...projectFilter(ctx, PERMISSIONS.project.read, 'id'),
              organizationId: ctx.organizationId,
              deletedAt: null,
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { key: { contains: query, mode: 'insensitive' } },
              ],
            },
            select: { id: true, name: true, key: true },
            orderBy: { name: 'asc' },
            take: 10,
          })
        : Promise.resolve([]),
    ])

    const projectHits: SearchHit[] = projects.map((project) => ({
      id: project.id,
      type: 'project',
      title: project.name,
      description: `Project · ${project.key}`,
      path: `/projects/${project.id}`,
    }))

    const deploymentHits: SearchHit[] = deployments.map((run) => ({
      id: run.id,
      type: 'deployment',
      title: run.title || `${run.reference} · ${run.version}`,
      description: `${run.reference} · ${run.environmentName}`,
      path: `/projects/${run.projectId}/deployments/${run.id}`,
    }))

    return [...projectHits, ...deploymentHits]
  }
}

export const searchService = new SearchService()
