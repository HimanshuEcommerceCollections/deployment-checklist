import 'server-only'

import { nanoid } from 'nanoid'

import { NotFoundError, PreconditionFailedError, ValidationError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import type { TemplateItem, TemplateSection } from '@prisma/client'

import type {
  CreateDraftVersionInput,
  CreateSectionInput,
  CreateItemInput,
  ReorderInput,
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

/**
 * Renumber `order` from an ordered id list, contiguously from 0.
 *
 * Live entries the caller did not mention keep their relative order and land
 * after the ones it did — so a stale client that has not seen a concurrently
 * added section cannot silently send it to position 0. Soft-deleted entries are
 * left untouched: they carry no meaningful order and renumbering them would make
 * a future restore land somewhere arbitrary.
 */
export function applyOrder<T extends { id: string; order: number; deletedAt?: Date | null }>(
  entries: T[],
  orderedIds: string[],
): T[] {
  const requested = orderedIds.filter((id) => entries.some((e) => e.id === id && !e.deletedAt))
  const unmentioned = entries
    .filter((e) => !e.deletedAt && !requested.includes(e.id))
    .sort((a, b) => a.order - b.order)
    .map((e) => e.id)

  const position = new Map([...requested, ...unmentioned].map((id, index) => [id, index]))

  return entries.map((entry) =>
    position.has(entry.id) ? { ...entry, order: position.get(entry.id)! } : entry,
  )
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
      throw new PreconditionFailedError('VERSION_PUBLISHED', { status: version.status })
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

  /**
   * Open a new DRAFT, optionally cloning an existing version's content.
   *
   * This is the only way to change a template after its first publish, because
   * published versions are frozen — deployment snapshots are taken from them, so
   * an edit would rewrite release history. The schema anticipated this
   * (`clonedFromVersionId`, "the service clones it to a DRAFT") but nothing
   * implemented it, which left every published template permanently unmodifiable.
   *
   * Item and section ids are preserved across the clone on purpose: `sourceItemId`
   * lineage is what makes "which item blocks releases most often" answerable
   * across versions. New ids would break that silently.
   *
   * `versionCounter` is monotonic and allocated with an atomic `$inc`, so two
   * people opening a draft at once cannot collide on `@@unique([templateId, version])`.
   */
  async createDraftVersion(
    ctx: RequestContext,
    templateId: string,
    input: CreateDraftVersionInput,
  ) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const template = await db.checklistTemplate.findFirstOrThrow({
      where: { id: templateId, organizationId: ctx.organizationId, deletedAt: null },
      include: {
        versions: {
          where: { deletedAt: null },
          orderBy: { version: 'desc' },
        },
      },
    })

    const existingDraft = template.versions.find((v) => v.status === 'DRAFT')
    if (existingDraft) {
      throw new ValidationError(
        `This template already has a draft (v${existingDraft.version}). Publish or delete it before starting another.`,
      )
    }

    const source = input.sourceVersionId
      ? template.versions.find((v) => v.id === input.sourceVersionId)
      : template.versions.find((v) => v.status === 'PUBLISHED')

    if (input.sourceVersionId && !source) {
      throw new NotFoundError('Template version')
    }

    // Drop soft-deleted content rather than carrying tombstones into a fresh
    // draft — they are noise the new version never needs to restore.
    const sections: Section[] = (source?.sections ?? [])
      .filter((s) => !s.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((s, sectionIndex) => ({
        ...s,
        order: sectionIndex,
        deletedAt: null,
        items: s.items
          .filter((i) => !i.deletedAt)
          .sort((a, b) => a.order - b.order)
          .map((i, itemIndex) => ({ ...i, order: itemIndex, deletedAt: null })),
      }))

    const { versionCounter } = await db.checklistTemplate.update({
      where: { id: templateId },
      data: { versionCounter: { increment: 1 }, updatedById: ctx.actorId },
      select: { versionCounter: true },
    })

    const version = await db.templateVersion.create({
      data: {
        organizationId: ctx.organizationId,
        templateId,
        version: versionCounter,
        status: 'DRAFT',
        changeNote: input.changeNote ?? null,
        sections: { set: sections },
        ...rollups(sections),
        completionPolicy: source?.completionPolicy ?? 'ALL_REQUIRED',
        clonedFromVersionId: source?.id ?? null,
        createdById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.template.versionCreated, {
      entityType: 'TemplateVersion',
      entityId: version.id,
      entityLabel: `v${version.version}`,
      metadata: source
        ? { clonedFrom: `v${source.version}`, sections: sections.length }
        : { clonedFrom: null },
      summary: source
        ? `${ctx.actorName} started draft v${version.version} from v${source.version} of "${template.name}"`
        : `${ctx.actorName} started empty draft v${version.version} of "${template.name}"`,
    })

    return version
  }

  async reorderSections(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    input: ReorderInput,
  ) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const draft = await this.loadDraft(ctx, templateId, versionId)
    const sections = applyOrder(draft.sections, input.orderedIds)

    await this.writeSections(ctx, versionId, sections)

    await audit.record(db, ctx, AUDIT_ACTIONS.template.sectionsReordered, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: `v${draft.version}`,
      metadata: { sectionCount: input.orderedIds.length },
    })

    return sections.filter((s) => !s.deletedAt).sort((a, b) => a.order - b.order)
  }

  async reorderItems(
    ctx: RequestContext,
    templateId: string,
    versionId: string,
    sectionId: string,
    input: ReorderInput,
  ) {
    requirePermission(ctx, PERMISSIONS.template.manage)

    const draft = await this.loadDraft(ctx, templateId, versionId)
    const target = draft.sections.find((s) => s.id === sectionId && !s.deletedAt)
    if (!target) throw new NotFoundError('Section')

    const sections = draft.sections.map((s) =>
      s.id === sectionId ? { ...s, items: applyOrder(s.items, input.orderedIds) } : s,
    )

    await this.writeSections(ctx, versionId, sections)

    await audit.record(db, ctx, AUDIT_ACTIONS.template.itemsReordered, {
      entityType: 'TemplateVersion',
      entityId: versionId,
      entityLabel: target.title,
      metadata: { itemCount: input.orderedIds.length },
    })

    return sections
      .find((s) => s.id === sectionId)!
      .items.filter((i) => !i.deletedAt)
      .sort((a, b) => a.order - b.order)
  }

  async publishVersion(ctx: RequestContext, templateId: string, versionId: string) {
    requirePermission(ctx, PERMISSIONS.template.publish)

    const draft = await this.loadDraft(ctx, templateId, versionId)

    if (draft.itemCount === 0) {
      throw new PreconditionFailedError('TEMPLATE_EMPTY')
    }

    const version = await db.$transaction(async (tx) => {
      const published = await tx.templateVersion.update({
        where: { id: versionId },
        data: {
          status: 'PUBLISHED',
          publishedById: ctx.actorId,
          publishedAt: new Date(),
          updatedById: ctx.actorId,
        },
      })

      // `currentVersionId` is documented as the pointer to the version served to
      // new deployments, but until now only the seed ever set it — so a second
      // published version left the template still advertising its first. Nothing
      // reads it in the execution path (a run names its version explicitly), so
      // this is about the template list telling the truth.
      await tx.checklistTemplate.update({
        where: { id: templateId },
        data: {
          currentVersionId: published.id,
          currentVersion: published.version,
          updatedById: ctx.actorId,
        },
      })

      return published
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

    /**
     * Load the version scoped through its template's organization first — every
     * sibling method does this, and this one did not: it updated by raw id, so a
     * `template.deprecate` holder in one organization could deprecate another
     * organization's published version. Only a PUBLISHED version can be
     * deprecated; deprecating a DRAFT would strand it (loadDraft requires DRAFT,
     * so it could never be edited or published again).
     */
    const current = await db.templateVersion.findFirst({
      where: {
        id: versionId,
        templateId,
        deletedAt: null,
        template: { organizationId: ctx.organizationId, deletedAt: null },
      },
      select: { id: true, status: true },
    })
    if (!current) throw new NotFoundError('TemplateVersion', versionId)
    if (current.status !== 'PUBLISHED') {
      throw new PreconditionFailedError('NOT_PUBLISHED', { status: current.status })
    }

    const version = await db.templateVersion.update({
      where: { id: current.id },
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
    if (!target) throw new NotFoundError('Section')

    const sections = draft.sections.map((s) =>
      s.id === sectionId
        ? {
            ...s,
            title: input.title ?? s.title,
            /**
             * `=== undefined`, not `??`: these fields are nullable, and null
             * means "clear it". `??` treated a deliberate clear as "keep the
             * old value", so an emptied description could never be saved.
             */
            description: input.description === undefined ? s.description : input.description,
            key: input.key === undefined ? s.key : input.key,
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
    if (!target) throw new NotFoundError('Section')

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
    if (!target) throw new NotFoundError('Section')

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
    if (!section || !target) throw new NotFoundError('Item')

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
                    /// `=== undefined` on the nullable fields: null is a
                    /// deliberate clear, which `??` silently discarded.
                    helpText: input.helpText === undefined ? i.helpText : input.helpText,
                    key: input.key === undefined ? i.key : input.key,
                    order: input.order ?? i.order,
                    isRequired: input.isRequired ?? i.isRequired,
                    evidenceRequired: input.evidenceRequired ?? i.evidenceRequired,
                    ownerRoleKey:
                      input.ownerRoleKey === undefined ? i.ownerRoleKey : input.ownerRoleKey,
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
    if (!section || !target) throw new NotFoundError('Item')

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
