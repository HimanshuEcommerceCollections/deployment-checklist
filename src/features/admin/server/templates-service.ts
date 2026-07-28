import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateTemplateInput, UpdateTemplateInput } from '../schemas/templates.schema'

export class TemplatesService {
  async listTemplates(ctx: RequestContext) {
    return db.checklistTemplate.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      include: { versions: { where: { deletedAt: null } } },
      orderBy: { name: 'asc' },
    })
  }

  async getTemplate(ctx: RequestContext, id: string) {
    return db.checklistTemplate.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      include: { versions: { where: { deletedAt: null } } },
    })
  }

  async createTemplate(ctx: RequestContext, input: CreateTemplateInput) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const template = await db.checklistTemplate.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        description: input.description,
        createdById: ctx.actorId,
        versions: {
          create: {
            versionNumber: 1,
            status: 'DRAFT',
            createdById: ctx.actorId,
          },
        },
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.created, {
      entityType: 'Template',
      entityId: template.id,
      entityLabel: template.name,
    })

    return template
  }

  async updateTemplate(ctx: RequestContext, id: string, input: UpdateTemplateInput) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const template = await db.checklistTemplate.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.updated, {
      entityType: 'Template',
      entityId: template.id,
      entityLabel: template.name,
    })

    return template
  }

  async deleteTemplate(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.template.delete)

    const template = await db.checklistTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.deleted, {
      entityType: 'Template',
      entityId: template.id,
      entityLabel: template.name,
    })

    return template
  }
}

export const templatesService = new TemplatesService()
