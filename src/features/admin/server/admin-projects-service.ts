import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

export class AdminProjectsService {
  async listAllProjects(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    return db.project.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      include: { _count: { select: { memberships: true, deployments: true } } },
      orderBy: { name: 'asc' },
    })
  }

  async createProject(ctx: RequestContext, input: { name: string; description?: string; color?: string; environments?: string[] }) {
    requirePermission(ctx, PERMISSIONS.project.create)

    const project = await db.project.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        description: input.description,
        color: input.color,
        createdById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.created, {
      entityType: 'Project',
      entityId: project.id,
      entityLabel: project.name,
    })

    return project
  }

  async updateProject(ctx: RequestContext, id: string, input: { name: string; description?: string; color?: string }) {
    requirePermission(ctx, PERMISSIONS.project.edit)

    const project = await db.project.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        color: input.color,
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.updated, {
      entityType: 'Project',
      entityId: project.id,
      entityLabel: project.name,
    })

    return project
  }

  async deleteProject(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.project.delete)

    const project = await db.project.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.deleted, {
      entityType: 'Project',
      entityId: project.id,
      entityLabel: project.name,
    })

    return project
  }
}

export const adminProjectsService = new AdminProjectsService()
