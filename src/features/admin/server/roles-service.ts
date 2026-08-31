import 'server-only'

import { ValidationError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS, WILDCARD } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateRoleInput, UpdateRoleInput } from '../schemas/roles.schema'

export class RolesService {
  /**
   * Full role rows, permission arrays included.
   *
   * Guarded because this is the organization's complete authority map — who could
   * do what — and it was reachable by any signed-in account via /admin/roles,
   * which had no page guard either. `roleNames()` below stays open by contrast:
   * id → display-name pairs label other pages and reveal nothing about grants.
   */
  async listRoles(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.role.read)

    return db.role.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
    })
  }

  /**
   * id → name, for anywhere that only needs to label a role.
   *
   * `listRoles` returns whole rows, and everything a server component awaits ends
   * up in the RSC flight payload — so using it just to resolve names shipped every
   * role's full permission array to the browser, including the admin role's `["*"]`.
   * Harmless behind `admin.access`, and still no reason to send it.
   */
  async roleNames(ctx: RequestContext) {
    const roles = await db.role.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return Object.fromEntries(roles.map((role) => [role.id, role.name]))
  }

  async getRole(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.role.read)

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

    /// Resolve inside the tenant first — `update({ where: { id } })` checks
    /// nothing else, so an id alone would reach another organization's roles.
    const current = await this.getRole(ctx, id)

    /// Permissions are granted by role key, and the seed re-asserts the system
    /// roles by key. Letting one drift silently detaches every grant that
    /// references it. Name, description and permissions stay editable.
    const key = current.isSystem ? current.key : input.key

    /// A super-admin role's grant is the wildcard, which the editor's catalog
    /// checkboxes cannot represent — every save would submit [] and silently
    /// strip `*` (it did, on 2026-08-31). The flag and the array must agree, so
    /// the wildcard is forced back regardless of what the form sent.
    const permissions = current.isSuperAdmin ? [WILDCARD] : input.permissions

    const role = await db.role.update({
      where: { id },
      data: {
        name: input.name,
        key,
        description: input.description,
        permissions,
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

    const current = await this.getRole(ctx, id)

    if (current.isSystem) {
      throw new ValidationError(`"${current.name}" is a system role and cannot be deleted.`)
    }

    /// A role still granted to someone is load-bearing. Deleting it strips those
    /// permissions silently, which reads as an unrelated authorization bug later.
    const [globalGrants, projectGrants] = await Promise.all([
      db.user.count({
        where: { organizationId: ctx.organizationId, roleIds: { has: id }, deletedAt: null },
      }),
      db.membership.count({
        where: { organizationId: ctx.organizationId, roleId: id, deletedAt: null },
      }),
    ])

    const inUse = globalGrants + projectGrants
    if (inUse > 0) {
      throw new ValidationError(
        `"${current.name}" is still granted to ${inUse} ${inUse === 1 ? 'account' : 'accounts'}. ` +
          'Remove those grants before deleting the role.',
      )
    }

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
