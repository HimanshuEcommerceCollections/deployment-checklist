import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type {
  CreateDeploymentInput,
  UpdateDeploymentItemInput,
  CreateCommentInput,
} from '../schemas/deployments.schema'

/// Only projects the caller is a member of. Applied to every read and write so a
/// valid id from another project is still a miss.
function memberScope(ctx: RequestContext) {
  return {
    organizationId: ctx.organizationId,
    deletedAt: null,
    memberships: { some: { userId: ctx.actorId, deletedAt: null } },
  }
}

export class DeploymentsService {
  async listProjectDeployments(ctx: RequestContext, projectId: string) {
    requirePermission(ctx, PERMISSIONS.deployment.read)

    return db.deploymentRun.findMany({
      where: { projectId, project: memberScope(ctx), deletedAt: null },
      include: {
        environment: true,
        _count: { select: { itemStates: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getDeployment(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.deployment.read)

    return db.deploymentRun.findFirstOrThrow({
      where: { id, project: memberScope(ctx), deletedAt: null },
      include: {
        project: true,
        environment: true,
        itemStates: { orderBy: [{ sectionId: 'asc' }, { order: 'asc' }] },
        comments: {
          where: { deletedAt: null },
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
  }

  async createDeployment(ctx: RequestContext, input: CreateDeploymentInput) {
    requirePermission(ctx, PERMISSIONS.deployment.create)

    const project = await db.project.findFirstOrThrow({
      where: { id: input.projectId, ...memberScope(ctx) },
      select: { id: true, key: true, environmentIds: true },
    })

    const version = await db.templateVersion.findFirstOrThrow({
      where: {
        id: input.templateVersionId,
        status: 'PUBLISHED',
        deletedAt: null,
        template: { organizationId: ctx.organizationId, deletedAt: null },
      },
      include: { template: { select: { id: true, key: true, name: true } } },
    })

    const environment = await db.environment.findFirstOrThrow({
      where: { id: input.environmentId, organizationId: ctx.organizationId, deletedAt: null },
    })

    if (project.environmentIds.length > 0 && !project.environmentIds.includes(environment.id)) {
      throw new Error(`${project.key} is not allowed to deploy to ${environment.name}.`)
    }

    if (environment.isProduction) {
      requirePermission(ctx, PERMISSIONS.deployment.production)
    }

    // Freeze the template content. Nothing in the execution path reads
    // TemplateVersion again — that is the point of the snapshot.
    const liveSections = version.sections
      .filter((s) => !s.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        order: s.order,
        sourceSectionId: s.id,
        items: s.items
          .filter((i) => !i.deletedAt)
          .filter(
            (i) => i.environmentKeys.length === 0 || i.environmentKeys.includes(environment.key),
          )
          .sort((a, b) => a.order - b.order)
          .map((i) => ({
            id: i.id,
            label: i.label,
            helpText: i.helpText,
            order: i.order,
            isRequired: i.isRequired,
            evidenceRequired: i.evidenceRequired,
            ownerRoleKey: i.ownerRoleKey,
            metadata: i.metadata ?? undefined,
            sourceItemId: i.id,
          })),
      }))
      .filter((s) => s.items.length > 0)

    const flatItems = liveSections.flatMap((s) => s.items.map((i) => ({ ...i, sectionId: s.id })))

    if (flatItems.length === 0) {
      throw new Error('The selected template version has no items for this environment.')
    }

    // Sequence is per project and must be unique — derive it from the current max
    // rather than a count, so soft-deleted runs cannot cause a collision.
    const latest = await db.deploymentRun.findFirst({
      where: { projectId: project.id },
      select: { sequence: true },
      orderBy: { sequence: 'desc' },
    })
    const sequence = (latest?.sequence ?? 0) + 1

    const deployment = await db.deploymentRun.create({
      data: {
        organizationId: ctx.organizationId,
        projectId: project.id,
        reference: `${project.key}-${sequence}`,
        sequence,
        templateId: version.template.id,
        templateVersionId: version.id,
        checklist: {
          templateId: version.template.id,
          templateVersionId: version.id,
          templateKey: version.template.key,
          templateName: version.template.name,
          version: version.version,
          completionPolicy: version.completionPolicy,
          capturedAt: new Date(),
          sections: liveSections,
        },
        environmentId: environment.id,
        environmentKey: environment.key,
        environmentName: environment.name,
        isProduction: environment.isProduction,
        version: input.version,
        title: input.title || null,
        releaseNotes: input.releaseNotes || null,
        scheduledAt: input.scheduledAt || null,
        status: 'DRAFT',
        totalItems: flatItems.length,
        totalRequired: flatItems.filter((i) => i.isRequired).length,
        searchText: [input.version, input.title, project.key, environment.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        createdById: ctx.actorId,
      },
    })

    await db.checklistItemState.createMany({
      data: flatItems.map((i) => ({
        organizationId: ctx.organizationId,
        deploymentId: deployment.id,
        sectionId: i.sectionId,
        itemId: i.id,
        order: i.order,
        isRequired: i.isRequired,
      })),
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.deployment.created, {
      entityType: 'DeploymentRun',
      entityId: deployment.id,
      entityLabel: deployment.reference,
    })

    return deployment
  }

  async updateDeploymentItem(
    ctx: RequestContext,
    deploymentId: string,
    itemId: string,
    input: UpdateDeploymentItemInput,
  ) {
    requirePermission(ctx, PERMISSIONS.deployment.execute)

    // Scoped by deployment AND membership so an id from another project misses.
    const deployment = await db.deploymentRun.findFirstOrThrow({
      where: { id: deploymentId, project: memberScope(ctx), deletedAt: null },
      select: { id: true, status: true, checklist: true },
    })

    const EDITABLE = ['DRAFT', 'IN_PROGRESS', 'BLOCKED']
    if (!EDITABLE.includes(deployment.status)) {
      throw new Error(
        `This deployment is ${deployment.status.toLowerCase()} and is no longer editable.`,
      )
    }

    const current = await db.checklistItemState.findFirstOrThrow({
      where: { deploymentId: deployment.id, itemId },
    })

    if (input.revision !== undefined && input.revision !== current.revision) {
      throw new Error('This item was changed by someone else. Reload and try again.')
    }

    const snapshotItem = deployment.checklist.sections
      .flatMap((s) => s.items)
      .find((i) => i.id === itemId)

    if (input.checked && snapshotItem?.evidenceRequired) {
      const note = input.note ?? current.note
      if (!note) {
        throw new Error(`"${snapshotItem.label}" requires a note as evidence.`)
      }
    }

    const item = await db.checklistItemState.update({
      where: { id: current.id },
      data: {
        checked: input.checked,
        skipped: input.skipped,
        note: input.note ?? current.note,
        checkedById: input.checked ? ctx.actorId : null,
        checkedByName: input.checked ? ctx.actorName : null,
        checkedAt: input.checked ? new Date() : null,
        revision: { increment: 1 },
        toggleCount: { increment: 1 },
      },
    })

    // Counters are denormalised on DeploymentRun so lists never aggregate.
    const [completedItems, completedRequired] = await Promise.all([
      db.checklistItemState.count({
        where: { deploymentId: deployment.id, OR: [{ checked: true }, { skipped: true }] },
      }),
      db.checklistItemState.count({
        where: {
          deploymentId: deployment.id,
          isRequired: true,
          OR: [{ checked: true }, { skipped: true }],
        },
      }),
    ])

    await db.deploymentRun.update({
      where: { id: deployment.id },
      data: { completedItems, completedRequired, updatedById: ctx.actorId },
    })

    await audit.record(
      db,
      ctx,
      input.checked ? AUDIT_ACTIONS.deployment.itemChecked : AUDIT_ACTIONS.deployment.itemUnchecked,
      {
        entityType: 'ChecklistItemState',
        entityId: item.id,
        entityLabel: snapshotItem?.label ?? itemId,
      },
    )

    return item
  }

  async addComment(ctx: RequestContext, deploymentId: string, input: CreateCommentInput) {
    requirePermission(ctx, PERMISSIONS.comment.create)

    const deployment = await db.deploymentRun.findFirstOrThrow({
      where: { id: deploymentId, project: memberScope(ctx), deletedAt: null },
      select: { id: true },
    })

    const comment = await db.deploymentComment.create({
      data: {
        organizationId: ctx.organizationId,
        deploymentId: deployment.id,
        authorId: ctx.actorId,
        authorName: ctx.actorName,
        body: input.body,
        itemId: input.itemId || null,
        parentId: input.parentId || null,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    })

    await db.deploymentRun.update({
      where: { id: deployment.id },
      data: { commentCount: { increment: 1 } },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.deployment.commentAdded, {
      entityType: 'DeploymentComment',
      entityId: comment.id,
      entityLabel: comment.body.slice(0, 80),
    })

    return comment
  }
}

export const deploymentsService = new DeploymentsService()
