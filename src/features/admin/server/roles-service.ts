import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateRoleInput, UpdateRoleInput } from '../schemas/roles.schema'

export class RolesService {
  async listRoles(ctx: RequestContext) {
    return db.role.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
    })
  }

  async getRole(ctx: RequestContext, id: string) {
    return db.role.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
    })
  }

  async createRole(ctx: RequestContext, input: CreateRoleInput) {
    requirePermission(ctx, PERMISSIONS.role.manage)

    const role = await db.role.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        key: input.key,
        description: input.description,
        permissions: input.permissions,
        isAssignableGlobally: input.isAssignableGlobally,
        createdById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.role.created, {
      entityType: 'Role',
      entityId: role.id,
      entityLabel: role.name,
      summary: `${ctx.actorName} created role "${role.name}"`,
    })

    return role
  }

  async updateRole(ctx: RequestContext, id: string, input: UpdateRoleInput) {
    requirePermission(ctx, PERMISSIONS.role.manage)

    const role = await db.role.update({
      where: { id },
      data: {
        name: input.name,
        key: input.key,
        description: input.description,
        permissions: input.permissions,
        isAssignableGlobally: input.isAssignableGlobally,
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.role.updated, {
      entityType: 'Role',
      entityId: role.id,
      entityLabel: role.name,
    })

    return role
  }

  async deleteRole(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.role.manage)

    const role = await db.role.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.role.deleted, {
      entityType: 'Role',
      entityId: role.id,
      entityLabel: role.name,
    })

    return role
  }
}

export const rolesService = new RolesService()
