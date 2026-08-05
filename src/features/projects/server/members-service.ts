import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * Project assignment.
 *
 * A Membership is one row per (user, project) and carries no role. Which roles a
 * person holds lives on `User.roleIds`; this decides which projects those roles
 * reach. `resolvePermissions` applies the user's project-scoped permissions to
 * every project they are assigned to, and nowhere else.
 *
 * It used to be one row per (user, project, role), so the same person could be
 * Engineer on one project and Viewer on another. That was removed deliberately —
 * for a team of this size, one role set per person is the model people actually
 * hold in their heads, and two places to look for someone's authority is the thing
 * that made the old design hard to reason about. `0009-lift-membership-roles-to-user`
 * unioned the per-project roles onto the user so nobody's access changed.
 */
export class MembersService {
  private async assertProject(ctx: RequestContext, projectId: string) {
    return db.project.findFirstOrThrow({
      where: { id: projectId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, key: true, name: true },
    })
  }

  /** Everyone assigned to this project. */
  async listProjectMembers(ctx: RequestContext, projectId: string) {
    requirePermission(ctx, PERMISSIONS.project.membersManage, { projectId })
    await this.assertProject(ctx, projectId)

    const rows = await db.membership.findMany({
      where: { projectId, organizationId: ctx.organizationId, deletedAt: null },
      include: {
        user: {
          select: { id: true, name: true, email: true, status: true, roleIds: true },
        },
      },
      orderBy: { user: { name: 'asc' } },
    })

    return rows.map((row) => ({ user: row.user, assignedAt: row.createdAt }))
  }

  /**
   * Every project a user is assigned to.
   *
   * The admin surface works user-first — "what should Sonika have access to?" —
   * while Membership is stored project-first. This is that query.
   */
  async listUserProjects(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.read)

    const rows = await db.membership.findMany({
      where: { userId, organizationId: ctx.organizationId, deletedAt: null },
      include: { project: { select: { id: true, name: true, key: true, deletedAt: true } } },
      orderBy: { project: { name: 'asc' } },
    })

    /// A soft-deleted project keeps its assignment rows; offering access to
    /// something no read can reach would be a dead end in the UI.
    return rows
      .filter((row) => !row.project.deletedAt)
      .map((row) => ({
        project: { id: row.project.id, name: row.project.name, key: row.project.key },
      }))
  }

  /**
   * Assign a user to a project.
   *
   * Idempotent: re-assigning revives a soft-deleted row rather than colliding with
   * `@@unique([userId, projectId])`, and an existing live row is a no-op.
   */
  async assignProject(ctx: RequestContext, projectId: string, userId: string) {
    requirePermission(ctx, PERMISSIONS.project.membersManage, { projectId })
    const project = await this.assertProject(ctx, projectId)

    const user = await db.user.findFirstOrThrow({
      where: { id: userId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, email: true },
    })

    /**
     * `deletedAt: undefined` so this sees revoked rows too.
     *
     * The soft-delete extension appends `deletedAt: null` to any read that does not
     * name the field, which would hide exactly the row we need to find — and
     * `@@unique([userId, projectId])` does not exclude soft-deleted rows, so the
     * `create` below would then collide with the row we could not see. The extension
     * keys off the field being present, so naming it with `undefined` opts out and
     * Prisma drops it from the filter. See src/lib/db/soft-delete-extension.ts.
     */
    const existing = await db.membership.findFirst({
      where: { projectId: project.id, userId: user.id, deletedAt: undefined },
      select: { id: true, deletedAt: true },
    })

    if (existing?.deletedAt === null) {
      return { userId: user.id, projectId: project.id, created: false }
    }

    if (existing) {
      await db.membership.update({
        where: { id: existing.id },
        data: { deletedAt: null, createdById: ctx.actorId },
      })
    } else {
      await db.membership.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: project.id,
          userId: user.id,
          createdById: ctx.actorId,
        },
      })
    }

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberAdded, {
      entityType: 'Membership',
      entityId: user.id,
      entityLabel: `${user.name} → ${project.key}`,
      projectId: project.id,
      targetUserId: user.id,
      summary: `${ctx.actorName} assigned ${user.email} to ${project.name}`,
    })

    return { userId: user.id, projectId: project.id, created: true }
  }

  async revokeProject(ctx: RequestContext, projectId: string, userId: string) {
    requirePermission(ctx, PERMISSIONS.project.membersManage, { projectId })
    const project = await this.assertProject(ctx, projectId)

    const user = await db.user.findFirstOrThrow({
      where: { id: userId, organizationId: ctx.organizationId },
      select: { id: true, name: true, email: true },
    })

    const { count } = await db.membership.updateMany({
      where: { projectId: project.id, userId: user.id, deletedAt: null },
      data: { deletedAt: new Date() },
    })

    if (count === 0) {
      throw new Error(`${user.name} is not assigned to ${project.key}.`)
    }

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberRemoved, {
      entityType: 'Membership',
      entityId: user.id,
      entityLabel: `${user.name} → ${project.key}`,
      projectId: project.id,
      targetUserId: user.id,
      summary: `${ctx.actorName} revoked ${user.email}'s access to ${project.name}`,
    })

    return { userId: user.id, projectId: project.id }
  }
}

export const membersService = new MembersService()
