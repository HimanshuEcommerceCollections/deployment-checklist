import 'server-only'

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

/// key and slug are unique per organization, so probe for a free suffix.
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
        OR: [{ key }, { slug }],
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })

    if (!clash) return { key, slug }
  }

  throw new Error(`Could not generate a unique key/slug for project "${name}"`)
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
    requirePermission(ctx, PERMISSIONS.project.edit)

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
