import 'server-only'

import { type RequestContext, projectFilter, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

export class AllDeploymentsService {
  async listUserDeployments(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.deployment.read)

    return db.deploymentRun.findMany({
      where: {
        // Scoped on projectId rather than through the `project` relation: the
        // filter belongs to the row being read, and DeploymentRun carries the id
        // directly, so this stays a single indexed predicate.
        ...projectFilter(ctx, PERMISSIONS.deployment.read),
        project: { organizationId: ctx.organizationId },
        deletedAt: null,
      },
      include: {
        project: true,
        environment: true,
        _count: { select: { itemStates: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }
}

export const allDeploymentsService = new AllDeploymentsService()
