import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import { invitationService } from '@/features/auth/server/invitation-service'

import type { InviteUserInput, UpdateUserInput } from '../schemas/users.schema'

export class UsersService {
  /**
   * Resolve inside the tenant before any write.
   *
   * `update({ where: { id } })` checks the id and nothing else, so without this
   * an actor holding `user.edit` could rename, deactivate or delete a user
   * belonging to another organization.
   */
  private async assertInTenant(ctx: RequestContext, userId: string, deleted = false) {
    return db.user.findFirstOrThrow({
      where: {
        id: userId,
        organizationId: ctx.organizationId,
        deletedAt: deleted ? { not: null } : null,
      },
      select: { id: true, name: true, email: true },
    })
  }

  async listUsers(ctx: RequestContext) {
    return db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        createdAt: true,
        roleIds: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getUser(ctx: RequestContext, userId: string) {
    return db.user.findFirstOrThrow({
      where: { id: userId, organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        roleIds: true,
        createdAt: true,
      },
    })
  }

  async inviteUser(ctx: RequestContext, input: InviteUserInput) {
    // Delegate to the existing invitation service
    return invitationService.invite(ctx, {
      email: input.email,
      name: input.name,
      roleIds: input.roleIds,
      message: undefined,
      projectGrants: [],
    })
  }

  async updateUser(ctx: RequestContext, userId: string, input: UpdateUserInput) {
    requirePermission(ctx, PERMISSIONS.user.edit)
    await this.assertInTenant(ctx, userId)

    return db.user.update({
      where: { id: userId },
      data: {
        name: input.name,
        status: input.status,
        roleIds: input.roleIds,
        updatedById: ctx.actorId,
      },
      select: { id: true, email: true, name: true, status: true },
    })
  }

  /**
   * `user.delete`, not `user.edit`. Deleting an account and renaming one are not
   * the same authority, and the permission catalog has always distinguished them.
   */
  async deleteUser(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.delete)
    const target = await this.assertInTenant(ctx, userId)

    /// Deleting yourself locks you out with no way back in through the UI. The
    /// recovery path is `npm run grant:admin`, which nobody remembers mid-incident.
    if (userId === ctx.actorId) {
      throw new Error('You cannot delete your own account.')
    }

    const user = await db.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: 'DEACTIVATED',
        /// Bumping the epoch revokes every live session for this user at once —
        /// a deleted account must not keep browsing on an unexpired JWT.
        sessionEpoch: { increment: 1 },
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.user.deleted, {
      entityType: 'User',
      entityId: user.id,
      entityLabel: target.email,
      targetUserId: user.id,
    })

    return user
  }

  async restoreUser(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.restore)
    const target = await this.assertInTenant(ctx, userId, true)

    /**
     * Restored as DEACTIVATED, deliberately. `email` is globally unique so the
     * row is still theirs, but a soft-deleted user may have been mid-invite or
     * mid-reset when they went; their password state is unknown to us. An admin
     * reactivates explicitly from the users page once they mean to let them in.
     */
    const user = await db.user.update({
      where: { id: userId },
      data: { deletedAt: null, status: 'DEACTIVATED', updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.user.restored, {
      entityType: 'User',
      entityId: user.id,
      entityLabel: target.email,
      targetUserId: user.id,
      summary: `${ctx.actorName} restored ${target.email} as deactivated`,
    })

    return user
  }
}

export const usersService = new UsersService()
