import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateDeploymentInput, UpdateDeploymentItemInput, CreateCommentInput } from '../schemas/deployments.schema'

export class DeploymentsService {
  async listProjectDeployments(ctx: RequestContext, projectId: string) {
    requirePermission(ctx, PERMISSIONS.deployment.read)

    return db.deploymentRun.findMany({
      where: {
        projectId,
        project: {
          organizationId: ctx.organizationId,
          members: { some: { userId: ctx.actorId, deletedAt: null } },
        },
        deletedAt: null,
      },
      include: { templateVersion: true, environment: true, _count: { select: { items: true, comments: true } } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getDeployment(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.deployment.read)

    return db.deploymentRun.findFirstOrThrow({
      where: {
        id,
        project: {
          organizationId: ctx.organizationId,
          members: { some: { userId: ctx.actorId, deletedAt: null } },
        },
        deletedAt: null,
      },
      include: {
        templateVersion: true,
        environment: true,
        items: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
        comments: { where: { deletedAt: null }, include: { author: true }, orderBy: { createdAt: 'desc' } },
      },
    })
  }

  async createDeployment(ctx: RequestContext, input: CreateDeploymentInput) {
    requirePermission(ctx, PERMISSIONS.deployment.create)

    const deployment = await db.deploymentRun.create({
      data: {
        projectId: input.projectId,
        templateVersionId: input.templateVersionId,
        environmentId: input.environment,
        title: input.title,
        releaseNotes: input.releaseNotes,
        status: 'DRAFT',
        createdById: ctx.actorId,
        items: {
          create: [
            { title: 'Placeholder', order: 1, createdById: ctx.actorId },
          ],
        },
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.deployment.created, {
      entityType: 'Deployment',
      entityId: deployment.id,
      entityLabel: deployment.title,
    })

    return deployment
  }

  async updateDeploymentItem(ctx: RequestContext, deploymentId: string, itemId: string, input: UpdateDeploymentItemInput) {
    requirePermission(ctx, PERMISSIONS.deployment.execute)

    const item = await db.checklistItemState.update({
      where: { id: itemId },
      data: {
        checked: input.checked,
        skipped: input.skipped,
        checkedById: input.checked ? ctx.actorId : null,
        checkedAt: input.checked ? new Date() : null,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.deployment.itemChecked, {
      entityType: 'DeploymentItem',
      entityId: item.id,
      entityLabel: item.title,
    })

    return item
  }

  async addComment(ctx: RequestContext, deploymentId: string, input: CreateCommentInput) {
    requirePermission(ctx, PERMISSIONS.comment.create)

    const comment = await db.deploymentComment.create({
      data: {
        deploymentRunId: deploymentId,
        authorId: ctx.actorId,
        content: input.content,
      },
      include: { author: true },
    })

    return comment
  }
}

export const deploymentsService = new DeploymentsService()
