import 'server-only'

import { reconcileRevocations } from '@/domain/authz/effective-permissions'
import { NotFoundError, PreconditionFailedError, ValidationError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS, WILDCARD } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import { invitationService } from '@/features/auth/server/invitation-service'

import type { InviteUserInput, UpdateUserInput } from '../schemas/users.schema'

/** Order-insensitive comparison, for deciding whether anything actually changed. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((key) => set.has(key))
}

/** Statuses from which an account can still sign in and exercise its roles. */
const CAN_SIGN_IN = ['ACTIVE'] as const

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
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        roleIds: true,
        extraPermissions: true,
        revokedPermissions: true,
      },
    })
  }

  /**
   * Ids of the roles that grant unrestricted access.
   *
   * Both signals count, because `can()` short-circuits on both: the explicit
   * `isSuperAdmin` flag, and the wildcard permission — a role listing `*` without
   * the flag still passes every check.
   */
  private async superAdminRoleIds(organizationId: string) {
    const roles = await db.role.findMany({
      where: {
        organizationId,
        deletedAt: null,
        OR: [{ isSuperAdmin: true }, { permissions: { has: WILDCARD } }],
      },
      select: { id: true },
    })

    return new Set(roles.map((r) => r.id))
  }

  /**
   * Refuse a change that would leave the organization with no way back in.
   *
   * `LAST_SUPER_ADMIN` has been in the error vocabulary since Phase 1 and nothing
   * ever raised it, because until the admin UI existed there was no way to reach
   * the situation — role changes happened at invite time or through
   * `npm run set:role`. Now that a form can suspend an account or clear its roles,
   * it is one click.
   *
   * The recovery path if this ever does happen is `npm run grant:admin`, which
   * requires shell access to the deployment and is precisely what nobody has to
   * hand at the moment they discover they are locked out.
   *
   * `nextRoleIds` and `nextStatus` describe the state AFTER the change; passing
   * the current values makes this a no-op check.
   */
  private async assertNotLastSuperAdmin(
    ctx: RequestContext,
    target: { id: string; email: string; status: string; roleIds: string[] },
    next: { roleIds?: string[]; status?: string },
  ) {
    const superRoles = await this.superAdminRoleIds(ctx.organizationId)
    if (superRoles.size === 0) return

    const wasSuper =
      target.roleIds.some((id) => superRoles.has(id)) &&
      CAN_SIGN_IN.includes(target.status as (typeof CAN_SIGN_IN)[number])
    if (!wasSuper) return

    const nextRoleIds = next.roleIds ?? target.roleIds
    const nextStatus = next.status ?? target.status
    const stillSuper =
      nextRoleIds.some((id) => superRoles.has(id)) &&
      CAN_SIGN_IN.includes(nextStatus as (typeof CAN_SIGN_IN)[number])
    if (stillSuper) return

    /// Count the others, not the total — the question is whether anyone else
    /// would be left, not how many there are.
    const others = await db.user.count({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        status: { in: [...CAN_SIGN_IN] },
        id: { not: target.id },
        roleIds: { hasSome: [...superRoles] },
      },
    })

    if (others === 0) {
      throw new PreconditionFailedError('LAST_SUPER_ADMIN', {
        email: target.email,
        recovery: 'npm run grant:admin -- <email>',
      })
    }
  }

  async listUsers(ctx: RequestContext) {
    /// Guarded in the service, not only in the page — this is the org's full
    /// account list and it had no check at either layer.
    requirePermission(ctx, PERMISSIONS.user.read)

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

  /**
   * One user, with everything the admin detail page needs.
   *
   * The pending invitation rides along because resend and revoke are keyed on the
   * invitation, not the user — an operator looking at an INVITED row should not
   * have to go and find its id. `null` for anyone who has accepted.
   */
  async getUser(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.read)

    const user = await db.user.findFirstOrThrow({
      where: { id: userId, organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        jobTitle: true,
        status: true,
        roleIds: true,
        extraPermissions: true,
        revokedPermissions: true,
        createdAt: true,
        lastLoginAt: true,
        passwordChangedAt: true,
        lockedUntil: true,
        failedLoginCount: true,
      },
    })

    const invitation = await db.invitation.findFirst({
      where: { organizationId: ctx.organizationId, createdUserId: user.id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, expiresAt: true, sentCount: true, lastSentAt: true, email: true },
    })

    return { ...user, invitation }
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

  /**
   * Edit name, status and roles.
   *
   * Suspending and role changes are separate audit actions rather than one generic
   * "updated", because those are the two entries anyone reading the trail after an
   * incident is looking for. This wrote no audit row at all before.
   */
  async updateUser(ctx: RequestContext, userId: string, input: UpdateUserInput) {
    requirePermission(ctx, PERMISSIONS.user.edit)
    const target = await this.assertInTenant(ctx, userId)

    /// Suspending someone is not the same authority as renaming them.
    if (input.status !== target.status) {
      requirePermission(ctx, PERMISSIONS.user.suspend)
    }

    await this.assertNotLastSuperAdmin(ctx, target, {
      roleIds: input.roleIds,
      status: input.status,
    })

    const roles = await db.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, permissions: true },
    })

    if (roles.length !== input.roleIds.length) {
      throw new NotFoundError('Role', 'one or more of the selected roles')
    }

    const rolesChanged =
      input.roleIds.length !== target.roleIds.length ||
      input.roleIds.some((id) => !target.roleIds.includes(id))

    const statusChanged = input.status !== target.status

    /**
     * A removal means "not this permission, even though the role grants it", so it
     * only has meaning against the role that was in force when it was made.
     * Assigning a role that grants a revoked permission therefore drops the
     * revocation — which is what brings `deployment.create` back when QA replaces
     * Engineer.
     *
     * Only the roles NEW in this change are considered, so an unrelated exception
     * survives an administrator adding a second role. The pure rule lives in
     * src/domain/authz/effective-permissions.ts.
     */
    const addedRoleIds = input.roleIds.filter((id) => !target.roleIds.includes(id))
    const grantedByNewRoles = roles
      .filter((role) => addedRoleIds.includes(role.id))
      .flatMap((role) => role.permissions)

    const revokedPermissions = reconcileRevocations({
      revoked: input.revokedPermissions,
      grantedByNewRoles,
    })

    /// Kept disjoint, so `extra` never contains something also revoked. The schema
    /// refuses the contradictory input; this keeps the stored pair consistent after
    /// the reconciliation above has moved things.
    const extraPermissions = input.extraPermissions.filter(
      (key) => !revokedPermissions.includes(key),
    )

    const permissionsChanged =
      !sameKeys(extraPermissions, target.extraPermissions) ||
      !sameKeys(revokedPermissions, target.revokedPermissions)

    const updated = await db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          name: input.name,
          status: input.status,
          roleIds: input.roleIds,
          extraPermissions,
          revokedPermissions,
          /**
           * Any of these takes effect on the next request rather than whenever the
           * JWT happens to expire. Permissions are resolved per request, but the
           * token carries the epoch — so without this, a suspended account keeps
           * browsing and a withdrawn permission keeps working until the token ages
           * out.
           */
          ...(statusChanged || rolesChanged || permissionsChanged
            ? { sessionEpoch: { increment: 1 } }
            : {}),
          ...(input.status === 'ACTIVE' && target.status !== 'ACTIVE'
            ? { failedLoginCount: 0, lockedUntil: null }
            : {}),
          updatedById: ctx.actorId,
        },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          roleIds: true,
          extraPermissions: true,
          revokedPermissions: true,
        },
      })

      if (statusChanged) {
        await audit.record(
          tx,
          ctx,
          input.status === 'ACTIVE'
            ? AUDIT_ACTIONS.user.reactivated
            : AUDIT_ACTIONS.user.suspended,
          {
            entityType: 'User',
            entityId: user.id,
            entityLabel: user.email,
            targetUserId: user.id,
            metadata: { from: target.status, to: input.status },
            summary: `${ctx.actorName} set ${user.email} to ${input.status.toLowerCase()}`,
          },
        )
      }

      if (rolesChanged) {
        await audit.record(tx, ctx, AUDIT_ACTIONS.user.roleChanged, {
          entityType: 'User',
          entityId: user.id,
          entityLabel: user.email,
          targetUserId: user.id,
          metadata: { roles: roles.map((r) => r.name) },
          summary: `${ctx.actorName} set ${user.email}'s roles to ${
            roles.map((r) => r.name).join(', ') || 'none'
          }`,
        })
      }

      /**
       * Its own entry, and deliberately not folded into `user.updated`. "Priya was
       * given deployment.production directly" is precisely the line someone reads
       * the audit log to find after an incident, and it would be invisible inside a
       * generic update.
       */
      if (permissionsChanged) {
        await audit.record(tx, ctx, AUDIT_ACTIONS.user.permissionsChanged, {
          entityType: 'User',
          entityId: user.id,
          entityLabel: user.email,
          targetUserId: user.id,
          metadata: { added: extraPermissions, removed: revokedPermissions },
          summary:
            `${ctx.actorName} changed ${user.email}'s permissions — ` +
            `${extraPermissions.length} added, ${revokedPermissions.length} removed`,
        })
      }

      if (!statusChanged && !rolesChanged && !permissionsChanged) {
        await audit.record(tx, ctx, AUDIT_ACTIONS.user.updated, {
          entityType: 'User',
          entityId: user.id,
          entityLabel: user.email,
          targetUserId: user.id,
        })
      }

      return user
    })

    return updated
  }

  /**
   * Send the invitation email again, from a user row.
   *
   * Resend and revoke are keyed on the invitation; the admin UI works in users. The
   * lookup lives here so the page does not have to know that, and so an accepted
   * account gives a clear answer rather than a missing id.
   */
  async resendInvitation(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.invite)
    const target = await this.assertInTenant(ctx, userId)

    const invitation = await this.pendingInvitation(ctx, target.id, target.email)
    return invitationService.resend(ctx, invitation.id)
  }

  async revokeInvitation(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.invite)
    const target = await this.assertInTenant(ctx, userId)

    const invitation = await this.pendingInvitation(ctx, target.id, target.email)
    return invitationService.revoke(ctx, invitation.id)
  }

  private async pendingInvitation(ctx: RequestContext, userId: string, email: string) {
    const invitation = await db.invitation.findFirst({
      where: { organizationId: ctx.organizationId, createdUserId: userId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    if (!invitation) {
      /**
       * Not a NotFoundError: that renders as a bare "Invitation not found", which
       * is a puzzle for an operator looking at a user rather than an invitation.
       * The id is withheld from 404 messages by design, so the explanation has to
       * come from an error type that carries one.
       */
      throw new ValidationError(
        `There is no pending invitation for ${email} — it was already accepted or withdrawn.`,
      )
    }

    return invitation
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
      throw new ValidationError('You cannot delete your own account.')
    }

    /// Deleting the last administrator is the same lockout by a different route,
    /// so it gets the same refusal. Modelled as "no roles, deactivated".
    await this.assertNotLastSuperAdmin(ctx, target, { roleIds: [], status: 'DEACTIVATED' })

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
