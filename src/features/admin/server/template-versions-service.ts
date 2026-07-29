import 'server-only'

import { nanoid } from 'nanoid'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import type { TemplateItem, TemplateSection } from '@prisma/client'

import type {
  CreateSectionInput,
  CreateItemInput,
  UpdateSectionInput,
  UpdateItemInput,
} from '../schemas/template-versions.schema'

type Section = TemplateSection
type Item = TemplateItem

/// Sections and items are embedded composite arrays, not tables. Prisma can only
/// rewrite a composite list wholesale, so every mutation reads the version, edits
/// the array in memory, and writes the whole array back — which also means an
/// embedded id is meaningless without its parent versionId.
function rollups(sections: Section[]) {
  const live = sections.filter((s) => !s.deletedAt)
  const items = live.flatMap((s) => s.items.filter((i) => !i.deletedAt))
  return {
    sectionCount: live.length,
    itemCount: items.length,
    requiredCount: items.filter((i) => i.isRequired).length,
  }
}

function nextOrder(entries: Array<{ order: number; deletedAt?: Date | null }>) {
  const live = entries.filter((e) => !e.deletedAt)
  return live.length === 0 ? 0 : Math.max(...live.map((e) => e.order)) + 1
}

export class TemplateVersionsService {
  /// Published and deprecated versions are immutable — deployment snapshots are
  /// taken from them, so editing one would silently rewrite release history.
  private async loadDraft(ctx: RequestContext, templateId: string, versionId: string) {
    const version = await db.templateVersion.findFirstOrThrow({
      where: {
        id: versionId,
        templateId,
        deletedAt: null,
        template: { organizationId: ctx.organizationId, deletedAt: null },
      },
    })

    if (version.status !== 'DRAFT') {
      throw new Error(
        `Version ${version.version} is ${version.status.toLowerCase()} and cannot be edited. Create a new draft instead.`,
      )
    }

    return version
  }

  private async writeSections(
    ctx: RequestContext,
    versionId: string,
    sections: Section[],
  ) {
    return db.templateVersion.update({
      where: { id: versionId },
      data: {
        sections: { set: sections },
        ...rollups(sections),
        updatedById: ctx.actorId,
      },
    })
  }

  async getVersion(ctx: RequestContext, templateId: string, versionId: string) {
    requirePermission(ctx, PERMISSIONS.template.read)

    const version = await db.templateVersion.findFirstOrThrow({
      where: {
        id: versionId,
        templateId,
        deletedAt: null,
        template: { organizationId: ctx.organizationId, deletedAt: null },
      },
      include: { template: true },
    })

    // Embedded arrays cannot be filtered or ordered by the query layer.
    const sections = version.sections
      .filter((s) => !s.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        ...s,
        items: s.items.filter((i) => !i.deletedAt).sort((a, b) => a.order - b.order),
      }))

    return { ...version, sections }
  }

  async publishVersion(ctx: RequestContext, templateId: string, versionId: string) {
    requirePermission(ctx, PERMISSIONS.template.publish)

    const draft = await this.loadDraft(ctx, templateId, versionId)

    if (draft.itemCount === 0) {
      throw new Error('Cannot publish a version with no checklist items.')
    }

    const version = await db.templateVersion.update({
      where: { id: versionId },
      data: {
        status: 'PUBLISHED',
        publishedById: ctx.actorId,
        publishedAt: new Date(),
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.versionPublished, {
      entityType: 'TemplateVersion',
      entityId: version.id,
      entityLabel: `v${version.version}`,
    })

    return version
  }

  async deprecateVersion(ctx: RequestContext, templateId: string, versionId: string) {
    requirePermission(ctx, PERMISSIONS.template.deprecate)

    const version = await db.templateVersion.update({
      where: { id: versionId },
      data: { status: 'DEPRECATED', deprecatedAt: new Date(), updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.versionDeprecated, {
      entityType: 'TemplateVersion',
      entityId: version.id,
      entityLabel: `v${version.version}`,
    })

    return version
  }

  async createSection(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    input: CreateSectionInput,
  ) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const draft = await this.loadDraft(ctx, templateId, versionId)

    const section: Section = {
      id: nanoid(),
      key: input.key ?? null,
      title: input.title,
      description: input.description ?? null,
      order: input.order ?? nextOrder(draft.sections),
      items: [],
      deletedAt: null,
    }

    await this.writeSections(ctx, versionId, [...draft.sections, section])

    await audit.record(db, ctx, AUDIT_ACTIONS.template.sectionCreated, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: section.title,
    })

    return section
  }

  async updateSection(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    sectionId: string,
    input: UpdateSectionInput,
  ) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const draft = await this.loadDraft(ctx, templateId, versionId)
    const target = draft.sections.find((s) => s.id === sectionId && !s.deletedAt)
    if (!target) throw new Error('Section not found')

    const sections = draft.sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            title: input.title ?? s.title,
            description: input.description ?? s.description,
            key: input.key ?? s.key,
            order: input.order ?? s.order,
          }
        : s,
    )

    await this.writeSections(ctx, versionId, sections)

    await audit.record(db, ctx, AUDIT_ACTIONS.template.sectionUpdated, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: input.title ?? target.title,
    })

    return sections.find((s) => s.id === sectionId)!
  }

  async deleteSection(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    sectionId: string,
  ) {
    requirePermission(ctx, PERMISSIONS.template.delete)

    const draft = await this.loadDraft(ctx, templateId, versionId)
    const target = draft.sections.find((s) => s.id === sectionId && !s.deletedAt)
    if (!target) throw new Error('Section not found')

    const deletedAt = new Date()
    const sections = draft.sections.map((s) =>
      s.id === sectionId
        ? { ...s, deletedAt, items: s.items.map((i) => ({ ...i, deletedAt: i.deletedAt ?? deletedAt })) }
        : s,
    )

    await this.writeSections(ctx, versionId, sections)

    await audit.record(db, ctx, AUDIT_ACTIONS.template.sectionDeleted, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: target.title,
    })

    return { id: sectionId, deletedAt }
  }

  async createItem(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    sectionId: string,
    input: CreateItemInput,
  ) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const draft = await this.loadDraft(ctx, templateId, versionId)
    const target = draft.sections.find((s) => s.id === sectionId && !s.deletedAt)
    if (!target) throw new Error('Section not found')

    const item: Item = {
      id: nanoid(),
      key: input.key ?? null,
      label: input.label,
      helpText: input.helpText ?? null,
      order: input.order ?? nextOrder(target.items),
      isRequired: input.isRequired,
      evidenceRequired: input.evidenceRequired,
      ownerRoleKey: input.ownerRoleKey ?? null,
      environmentKeys: input.environmentKeys,
      metadata: null,
      deletedAt: null,
    }

    const sections = draft.sections.map((s) =>
      s.id === sectionId ? { ...s, items: [...s.items, item] } : s,
    )

    await this.writeSections(ctx, versionId, sections)

    await audit.record(db, ctx, AUDIT_ACTIONS.template.itemCreated, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: item.label,
    })

    return item
  }

  async updateItem(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    sectionId: string,
    itemId: string,
    input: UpdateItemInput,
  ) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const draft = await this.loadDraft(ctx, templateId, versionId)
    const section = draft.sections.find((s) => s.id === sectionId && !s.deletedAt)
    const target = section?.items.find((i) => i.id === itemId && !i.deletedAt)
    if (!section || !target) throw new Error('Item not found')

    const sections = draft.sections.map((s) =>
      s.id !== sectionId
        ? s
        : {
            ...s,
            items: s.items.map((i) =>
              i.id !== itemId
                ? i
                : {
                    ...i,
                    label: input.label ?? i.label,
                    helpText: input.helpText ?? i.helpText,
                    key: input.key ?? i.key,
                    order: input.order ?? i.order,
                    isRequired: input.isRequired ?? i.isRequired,
                    evidenceRequired: input.evidenceRequired ?? i.evidenceRequired,
                    ownerRoleKey: input.ownerRoleKey ?? i.ownerRoleKey,
                    environmentKeys: input.environmentKeys ?? i.environmentKeys,
                  },
            ),
          },
    )

    await this.writeSections(ctx, versionId, sections)

    await audit.record(db, ctx, AUDIT_ACTIONS.template.itemUpdated, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: input.label ?? target.label,
    })

    return sections
      .find((s) => s.id === sectionId)!
      .items.find((i) => i.id === itemId)!
  }

  async deleteItem(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    sectionId: string,
    itemId: string,
  ) {
    requirePermission(ctx, PERMISSIONS.template.delete)

    const draft = await this.loadDraft(ctx, templateId, versionId)
    const section = draft.sections.find((s) => s.id === sectionId && !s.deletedAt)
    const target = section?.items.find((i) => i.id === itemId && !i.deletedAt)
    if (!section || !target) throw new Error('Item not found')

    const deletedAt = new Date()
    const sections = draft.sections.map((s) =>
      s.id !== sectionId
        ? s
        : { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, deletedAt } : i)) },
    )

    await this.writeSections(ctx, versionId, sections)

    await audit.record(db, ctx, AUDIT_ACTIONS.template.itemDeleted, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: target.label,
    })

    return { id: itemId, deletedAt }
  }
}

export const templateVersionsService = new TemplateVersionsService()
