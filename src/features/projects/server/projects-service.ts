import 'server-only'

import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

export class ProjectsService {
  async listUserProjects(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.project.read)

    return db.project.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        memberships: {
          some: {
            userId: ctx.actorId,
            deletedAt: null,
          },
        },
      },
      include: {
        _count: { select: { memberships: true, deployments: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getProject(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.project.read)

    return db.project.findFirstOrThrow({
      where: {
        id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        memberships: {
          some: {
            userId: ctx.actorId,
            deletedAt: null,
          },
        },
      },
      include: {
        memberships: { where: { deletedAt: null }, include: { user: true } },
        _count: { select: { deployments: true } },
      },
    })
  }
}

export const projectsService = new ProjectsService()
