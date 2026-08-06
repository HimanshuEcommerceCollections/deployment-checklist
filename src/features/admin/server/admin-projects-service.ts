import 'server-only'

import { InternalError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

function keyify(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 12)
}

/**
 * key and slug are unique per organization, so probe for a free suffix.
 *
 * `deletedAt: undefined` is load-bearing. `@@unique([organizationId, key])` does
 * not exclude soft-deleted rows, so a deleted project still occupies its key in
 * the index — but the soft-delete extension would otherwise append
 * `deletedAt: null` here and hide exactly the row that is about to collide. The
 * probe would report the key free and `create` would then fail on the unique
 * index with an opaque 500. The extension keys off presence, not value, so
 * naming the field with `undefined` opts this one query out and lets Prisma drop
 * it from the filter. See src/lib/db/soft-delete-extension.ts.
 */
async function resolveIdentifiers(
  organizationId: string,
  name: string,
  requestedKey?: string,
  excludeId?: string,
) {
  const baseKey = keyify(requestedKey || name) || 'PROJ'
  const baseSlug = slugify(name) || 'project'

  for (let attempt = 0; attempt < 50; attempt++) {
    const suffix = attempt === 0 ? '' : String(attempt + 1)
    const key = baseKey.slice(0, 12 - suffix.length) + suffix
    const slug = baseSlug.slice(0, 60 - suffix.length - 1) + (suffix ? `-${suffix}` : '')

    const clash = await db.project.findFirst({
      where: {
        organizationId,
        deletedAt: undefined,
        OR: [{ key }, { slug }],
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })

    if (!clash) return { key, slug }
  }

  throw new InternalError(`Could not generate a unique key/slug for project "${name}"`)
}

export class AdminProjectsService {
  async listAllProjects(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    return db.project.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      include: { _count: { select: { memberships: true, deployments: true } } },
      orderBy: { name: 'asc' },
    })
  }

  async createProject(ctx: RequestContext, input: { name: string; description?: string; color?: string; key?: string; environments?: string[] }) {
    requirePermission(ctx, PERMISSIONS.project.create)

    const { key, slug } = await resolveIdentifiers(ctx.organizationId, input.name, input.key)

    const project = await db.project.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        key,
        slug,
        description: input.description || null,
        color: input.color || undefined,
        environmentIds: input.environments ?? [],
        searchText: [input.name, key, input.description].filter(Boolean).join(' ').toLowerCase(),
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

  async updateProject(ctx: RequestContext, id: string, input: { name: string; description?: string; color?: string; key?: string }) {
    requirePermission(ctx, PERMISSIONS.project.edit, { projectId: id })

    const current = await db.project.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      select: { key: true, slug: true, name: true },
    })

    const renamed = input.name !== current.name
    const rekeyed = Boolean(input.key) && keyify(input.key!) !== current.key
    const identifiers =
      renamed || rekeyed
        ? await resolveIdentifiers(ctx.organizationId, input.name, input.key, id)
        : { key: current.key, slug: current.slug }

    const project = await db.project.update({
      where: { id },
      data: {
        name: input.name,
        key: identifiers.key,
        slug: identifiers.slug,
        description: input.description || null,
        color: input.color || undefined,
        searchText: [input.name, identifiers.key, input.description]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
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
    requirePermission(ctx, PERMISSIONS.project.delete, { projectId: id })

    /// Resolve inside the tenant first. `update({ where: { id } })` alone would
    /// happily soft-delete another organization's project for anyone holding
    /// `project.delete` — the id is the only thing it checks.
    await db.project.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    })

    const project = await db.project.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: ctx.actorId, updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.deleted, {
      entityType: 'Project',
      entityId: project.id,
      entityLabel: project.name,
    })

    return project
  }

  async restoreProject(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.project.restore, { projectId: id })

    const deleted = await db.project.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: { not: null } },
      select: { id: true, name: true, key: true, slug: true },
    })

    /**
     * Normally unreachable, and kept anyway.
     *
     * `@@unique([organizationId, key])` does not exclude soft-deleted rows, so a
     * project in the trash still holds its key and slug — nothing can take them
     * while it sits there, and the restore below gets them back unchanged. That
     * guarantee disappears the moment someone adds `deletedAt` to those indexes
     * to allow key reuse, which is the obvious way to implement that. Re-resolve
     * instead of dying on an index violation the operator cannot act on.
     */
    const clash = await db.project.findFirst({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        OR: [{ key: deleted.key }, { slug: deleted.slug }],
      },
      select: { id: true },
    })

    const identifiers = clash
      ? await resolveIdentifiers(ctx.organizationId, deleted.name, deleted.key, deleted.id)
      : { key: deleted.key, slug: deleted.slug }

    const project = await db.project.update({
      where: { id: deleted.id },
      data: {
        deletedAt: null,
        deletedById: null,
        key: identifiers.key,
        slug: identifiers.slug,
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.restored, {
      entityType: 'Project',
      entityId: project.id,
      entityLabel: project.name,
      summary:
        identifiers.key === deleted.key
          ? undefined
          : `Restored as ${identifiers.key} — ${deleted.key} was taken`,
    })

    return project
  }
}

export const adminProjectsService = new AdminProjectsService()
