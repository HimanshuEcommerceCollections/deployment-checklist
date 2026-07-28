import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateSectionInput, CreateItemInput, UpdateSectionInput, UpdateItemInput } from '../schemas/template-versions.schema'

export class TemplateVersionsService {
  async getVersion(ctx: RequestContext, templateId: string, versionId: string) {
    requirePermission(ctx, PERMISSIONS.template.read)

    return db.templateVersion.findFirstOrThrow({
      where: {
        id: versionId,
        templateId,
        template: { organizationId: ctx.organizationId, deletedAt: null },
      },
      include: { sections: { where: { deletedAt: null }, orderBy: { order: 'asc' } } },
    })
  }

  async publishVersion(ctx: RequestContext, templateId: string, versionId: string) {
    requirePermission(ctx, PERMISSIONS.template.publish)

    const version = await db.templateVersion.update({
      where: { id: versionId },
      data: { status: 'PUBLISHED', publishedById: ctx.actorId, publishedAt: new Date() },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.published, {
      entityType: 'TemplateVersion',
      entityId: version.id,
      entityLabel: `v${version.versionNumber}`,
    })

    return version
  }

  async deprecateVersion(ctx: RequestContext, templateId: string, versionId: string) {
    requirePermission(ctx, PERMISSIONS.template.deprecate)

    const version = await db.templateVersion.update({
      where: { id: versionId },
      data: { status: 'DEPRECATED' },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.deprecated, {
      entityType: 'TemplateVersion',
      entityId: version.id,
      entityLabel: `v${version.versionNumber}`,
    })

    return version
  }

  async createSection(ctx: RequestContext, templateId: string, versionId: string, input: CreateSectionInput) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const section = await db.templateSection.create({
      data: {
        versionId,
        title: input.title,
        description: input.description,
        order: input.order,
        createdById: ctx.actorId,
      },
    })

    return section
  }

  async updateSection(ctx: RequestContext, sectionId: string, input: UpdateSectionInput) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    return db.templateSection.update({
      where: { id: sectionId },
      data: {
        title: input.title,
        description: input.description,
        order: input.order,
        updatedById: ctx.actorId,
      },
    })
  }

  async deleteSection(ctx: RequestContext, sectionId: string) {
    requirePermission(ctx, PERMISSIONS.template.delete)

    return db.templateSection.update({
      where: { id: sectionId },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })
  }

  async createItem(ctx: RequestContext, sectionId: string, input: CreateItemInput) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    return db.templateItem.create({
      data: {
        sectionId,
        title: input.title,
        description: input.description,
        requiresEvidence: input.requiresEvidence,
        order: input.order,
        createdById: ctx.actorId,
      },
    })
  }

  async updateItem(ctx: RequestContext, itemId: string, input: UpdateItemInput) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    return db.templateItem.update({
      where: { id: itemId },
      data: {
        title: input.title,
        description: input.description,
        requiresEvidence: input.requiresEvidence,
        order: input.order,
        updatedById: ctx.actorId,
      },
    })
  }

  async deleteItem(ctx: RequestContext, itemId: string) {
    requirePermission(ctx, PERMISSIONS.template.delete)

    return db.templateItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })
  }
}

export const templateVersionsService = new TemplateVersionsService()
