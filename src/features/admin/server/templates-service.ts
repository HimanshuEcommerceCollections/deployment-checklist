import 'server-only'

import { InternalError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateTemplateInput, UpdateTemplateInput } from '../schemas/templates.schema'

export class TemplatesService {
  /**
   * key is unique per organization — probe for a free suffix.
   *
   * `deletedAt: undefined` opts this query out of the soft-delete filter, which
   * would otherwise hide the very rows that can collide:
   * `@@unique([organizationId, key])` still counts soft-deleted templates, so a
   * probe that sees only live rows reports a taken key as free and the following
   * `create` dies on the index. The extension keys off the field being present,
   * so naming it with `undefined` is the opt-out and Prisma drops it from the
   * filter. See src/lib/db/soft-delete-extension.ts.
   */
  private async resolveKey(ctx: RequestContext, name: string, excludeId?: string) {
    const base =
      name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .slice(0, 12) || 'TPL'

    for (let attempt = 0; attempt < 50; attempt++) {
      const suffix = attempt === 0 ? '' : String(attempt + 1)
      const key = base.slice(0, 12 - suffix.length) + suffix

      const clash = await db.checklistTemplate.findFirst({
        where: {
          organizationId: ctx.organizationId,
          deletedAt: undefined,
          key,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        select: { id: true },
      })

      if (!clash) return key
    }

    throw new InternalError(`Could not generate a unique key for template "${name}"`)
  }

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

    const key = await this.resolveKey(ctx, input.name)

    const template = await db.checklistTemplate.create({
      data: {
        organizationId: ctx.organizationId,
        key,
        name: input.name,
        description: input.description || null,
        createdById: ctx.actorId,
        versionCounter: 1,
        searchText: [input.name, key, input.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        versions: {
          create: {
            organizationId: ctx.organizationId,
            version: 1,
            status: 'DRAFT',
            sections: [],
            createdById: ctx.actorId,
            // Explicit because the soft-delete extension only stamps the
            // TOP-LEVEL `data` of a create — it does not reach into a nested
            // relation create. Without this the version row is written with no
            // `deletedAt` key, and on MongoDB Prisma reads `deletedAt: null` as
            // "present and null", so the draft is invisible to getVersion(),
            // loadDraft(), and the versions list. The template would appear to
            // have no versions at all. See src/lib/db/soft-delete-extension.ts.
            deletedAt: null,
          },
        },
      },
      include: { versions: true },
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

    await this.getTemplate(ctx, id)

    const template = await db.checklistTemplate.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description || null,
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

    await this.getTemplate(ctx, id)

    const template = await db.checklistTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: ctx.actorId, updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.deleted, {
      entityType: 'Template',
      entityId: template.id,
      entityLabel: template.name,
    })

    return template
  }

  async restoreTemplate(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.template.restore)

    const deleted = await db.checklistTemplate.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: { not: null } },
      select: { id: true, name: true, key: true },
    })

    const key = await this.resolveKey(ctx, deleted.name, deleted.id)

    const template = await db.checklistTemplate.update({
      where: { id: deleted.id },
      data: { deletedAt: null, deletedById: null, key, updatedById: ctx.actorId },
    })

    /// Versions need no attention: deleteTemplate does not cascade to them, so
    /// they are still live and reachable the moment the template is back.

    await audit.record(db, ctx, AUDIT_ACTIONS.template.restored, {
      entityType: 'Template',
      entityId: template.id,
      entityLabel: template.name,
      templateId: template.id,
      summary:
        key === deleted.key ? undefined : `Restored as ${key} — ${deleted.key} was taken`,
    })

    return template
  }
}

export const templatesService = new TemplatesService()
