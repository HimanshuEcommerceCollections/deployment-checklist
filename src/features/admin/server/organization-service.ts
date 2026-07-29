import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { UpdateOrganizationInput } from '../schemas/organization.schema'

export class OrganizationService {
  async getOrganization(ctx: RequestContext) {
    return db.organization.findUniqueOrThrow({
      where: { id: ctx.organizationId },
      select: { id: true, name: true, slug: true, isActive: true, createdAt: true },
    })
  }

  async updateOrganization(ctx: RequestContext, input: UpdateOrganizationInput) {
    requirePermission(ctx, PERMISSIONS.settings.manage)

    // slug is globally unique — it addresses the tenant.
    const taken = await db.organization.findFirst({
      where: { slug: input.slug, id: { not: ctx.organizationId } },
      select: { id: true },
    })
    if (taken) throw new Error('That slug is already taken.')

    const org = await db.organization.update({
      where: { id: ctx.organizationId },
      data: { name: input.name, slug: input.slug },
      select: { id: true, name: true, slug: true, isActive: true, createdAt: true },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.settings.updated, {
      entityType: 'Organization',
      entityId: org.id,
      entityLabel: org.name,
    })

    return org
  }
}

export const organizationService = new OrganizationService()
