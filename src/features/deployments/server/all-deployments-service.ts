import 'server-only'

import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

export class AllDeploymentsService {
  async listUserDeployments(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.deployment.read)

    return db.deploymentRun.findMany({
      where: {
        project: {
          organizationId: ctx.organizationId,
          memberships: {
            some: {
              userId: ctx.actorId,
              deletedAt: null,
            },
          },
        },
        deletedAt: null,
      },
      include: {
        project: true,
        environment: true,
        templateVersion: true,
        _count: { select: { items: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
  }
}

export const allDeploymentsService = new AllDeploymentsService()
