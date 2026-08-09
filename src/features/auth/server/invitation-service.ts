import 'server-only'

import { ConflictError, NotFoundError, PreconditionFailedError, ValidationError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { hashPassword } from '@/lib/auth/password'
import { DEFAULT_POLICY, checkPassword } from '@/lib/auth/password-policy'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { env } from '@/lib/config/env'
import { generateToken, hashToken } from '@/lib/crypto'
import { isUniqueViolation } from '@/lib/db/errors'
import { db } from '@/lib/db/prisma'
import { RATE_LIMITS, consume } from '@/lib/http/rate-limit'
import { notifications } from '@/lib/notifications/dispatcher'

import type { AcceptInviteInput, InviteUserInput } from '../schemas/auth.schema'

/**
 * Invite-only onboarding.
 *
 * The raw token exists in memory for one request and inside one email. Only its
 * SHA-256 hash is persisted, so a database compromise yields no usable invite
 * links.
 *
 * A `User` row IS created at invite time with `status: INVITED`, because the
 * admin needs pending people visible in the user list, roles need somewhere to
 * live, and Membership rows need a userId. Acceptance flips the status and sets a
 * password — it does not create the user.
 */
export class InvitationService {
  async invite(ctx: RequestContext, input: InviteUserInput) {
    requirePermission(ctx, PERMISSIONS.user.invite)

    const limit = await consume(RATE_LIMITS.invite(ctx.actorId))
    if (!limit.allowed) {
      throw new ValidationError('You have sent a lot of invitations recently. Try again shortly.')
    }

    /**
     * Include soft-deleted rows. `email` is globally unique, so a placeholder
     * user left behind by a revoked or trashed invite still holds the address —
     * filtering `deletedAt: null` hid it, sent the code down the `create` branch,
     * and hit the unique index with an opaque "Something went wrong". Scoped to
     * this organisation because the unique email is global: a match in another
     * org is handled by the P2002 mapping below, not revived here.
     */
    const existing = await db.user.findFirst({
      where: { email: input.email, organizationId: ctx.organizationId },
      select: { id: true, status: true, email: true, deletedAt: true },
    })

    if (existing && existing.status === 'ACTIVE' && !existing.deletedAt) {
      throw new ConflictError('DUPLICATE_KEY', { field: 'email' })
    }

    // Validate the roles exist and are grantable in the requested scope, rather
    // than trusting ids from the form.
    const roles = await db.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, key: true, name: true, isAssignableGlobally: true, permissions: true },
    })

    if (roles.length !== input.roleIds.length) {
      throw new ValidationError('One or more selected roles no longer exist', {
        roleIds: ['Select valid roles'],
      })
    }
    for (const role of roles) {
      if (!role.isAssignableGlobally) {
        throw new ValidationError(`"${role.name}" cannot be granted organisation-wide`, {
          roleIds: [`"${role.name}" is project-scoped only`],
        })
      }
    }

    // Privilege-escalation guard: you cannot grant a permission you do not hold.
    // Without this, anyone with user.invite could mint themselves an admin.
    this.assertNoEscalation(ctx, roles)

    const settings = await db.setting.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { inviteExpiryHours: true },
    })
    const expiryHours = settings?.inviteExpiryHours ?? 72

    const rawToken = generateToken()
    const tokenHash = hashToken(rawToken)
    const expiresAt = new Date(Date.now() + expiryHours * 3600_000)

    const result = await db.$transaction(async (tx) => {
      // Supersede any outstanding invitation for this email so only the newest
      // link works — otherwise a resend leaves two valid tokens alive.
      await tx.invitation.updateMany({
        where: { email: input.email, organizationId: ctx.organizationId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: ctx.actorId },
      })

      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              name: input.name ?? undefined,
              roleIds: input.roleIds,
              status: 'INVITED',
              // Revive a soft-deleted placeholder so the re-invite lands on the
              // existing row rather than colliding with the unique email.
              deletedAt: null,
              invitedById: ctx.actorId,
              updatedById: ctx.actorId,
            },
            select: { id: true, email: true, name: true },
          })
        : await tx.user.create({
            data: {
              organizationId: ctx.organizationId,
              email: input.email,
              name: input.name ?? input.email.split('@')[0]!,
              status: 'INVITED',
              roleIds: input.roleIds,
              invitedById: ctx.actorId,
              createdById: ctx.actorId,
            },
            select: { id: true, email: true, name: true },
          })

      const invitation = await tx.invitation.create({
        data: {
          organizationId: ctx.organizationId,
          email: input.email,
          name: input.name ?? null,
          roleIds: input.roleIds,
          projectGrants: input.projectGrants.length ? input.projectGrants : undefined,
          tokenHash,
          expiresAt,
          message: input.message ?? null,
          invitedById: ctx.actorId,
          sentCount: 1,
          lastSentAt: new Date(),
          createdUserId: user.id,
        },
        select: { id: true, email: true, expiresAt: true },
      })

      await audit.record(tx, ctx, AUDIT_ACTIONS.user.invited, {
        entityType: 'Invitation',
        entityId: invitation.id,
        entityLabel: input.email,
        targetUserId: user.id,
        metadata: {
          roles: roles.map((r) => r.key),
          projectGrantCount: input.projectGrants.length,
          expiresAt: expiresAt.toISOString(),
        },
        summary: `${ctx.actorName} invited ${input.email} as ${roles.map((r) => r.name).join(', ')}`,
      })

      await notifications.enqueue(
        {
          templateKey: 'user-invite',
          organizationId: ctx.organizationId,
          // Natural key: one email per invitation, however many times the
          // enclosing request is retried.
          idempotencyKey: `invite:${invitation.id}`,
          recipients: [{ email: input.email, name: input.name, userId: user.id }],
          payload: {
            email: input.email,
            inviterName: ctx.actorName,
            roleNames: roles.map((r) => r.name),
            expiresInHours: expiryHours,
            message: input.message ?? null,
            acceptUrl: `${env.APP_URL}/accept-invite/${rawToken}`,
          },
          relatedEntityType: 'Invitation',
          relatedEntityId: invitation.id,
        },
        tx,
      )

      return { invitation, userId: user.id }
    }).catch((error) => {
      // A unique-email collision here can only be a match in another organisation
      // (a same-org row was revived above). Surface it as a clear conflict rather
      // than the opaque INTERNAL_ERROR a raw P2002 becomes.
      if (isUniqueViolation(error)) {
        throw new ConflictError('DUPLICATE_KEY', { field: 'email' })
      }
      throw error
    })

    return result
  }

  /**
   * Validate a token for the GET that renders the accept form.
   *
   * Returns a discriminated result rather than throwing, because each invalid
   * state deserves a different, non-alarming page.
   */
  async inspectToken(rawToken: string) {
    const invitation = await db.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        expiresAt: true,
        message: true,
        organizationId: true,
      },
    })

    if (!invitation) return { state: 'invalid' as const }
    if (invitation.status === 'ACCEPTED') return { state: 'used' as const }
    if (invitation.status === 'REVOKED') return { state: 'revoked' as const }

    if (invitation.expiresAt <= new Date()) {
      // Mark it so the admin list reflects reality rather than showing PENDING
      // for an invitation that can never be accepted.
      if (invitation.status === 'PENDING') {
        await db.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } })
      }
      return { state: 'expired' as const }
    }

    return { state: 'valid' as const, invitation }
  }

  async accept(input: AcceptInviteInput, meta: { ip?: string; userAgent?: string }) {
    if (meta.ip) {
      const limit = await consume(RATE_LIMITS.acceptInvite(meta.ip))
      if (!limit.allowed) throw new ValidationError('Too many attempts. Please try again shortly.')
    }

    // Re-validate inside the POST. The GET only proved the token was valid THEN,
    // and the token arrives from a URL the client controls.
    const inspected = await this.inspectToken(input.token)
    if (inspected.state !== 'valid') {
      throw new PreconditionFailedError('INVITE_NOT_VALID', { state: inspected.state })
    }

    const { invitation } = inspected

    const settings = await db.setting.findUnique({
      where: { organizationId: invitation.organizationId },
      select: { passwordMinLength: true, passwordRequireMixed: true },
    })

    const policy = {
      minLength: settings?.passwordMinLength ?? DEFAULT_POLICY.minLength,
      requireMixed: settings?.passwordRequireMixed ?? DEFAULT_POLICY.requireMixed,
    }

    const check = checkPassword(input.password, policy, {
      email: invitation.email,
      name: input.name,
    })
    if (!check.ok) {
      throw new ValidationError(check.problems[0]!, { password: check.problems })
    }

    const passwordHash = await hashPassword(input.password)
    const now = new Date()

    return db.$transaction(async (tx) => {
      const full = await tx.invitation.findUniqueOrThrow({
        where: { id: invitation.id },
        select: { roleIds: true, projectGrants: true, createdUserId: true, email: true },
      })

      /**
       * Claim the invitation first, as a compare-and-set on PENDING. Two truly
       * concurrent accepts of the same token both passed the pre-transaction
       * `inspectToken`; without this guard both would commit — double session-epoch
       * bump, duplicate audit rows. Consuming it up front means the second
       * transaction matches zero rows and rolls the whole accept back.
       */
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedAt: now, acceptedIp: meta.ip ?? null },
      })
      if (claimed.count === 0) {
        throw new PreconditionFailedError('INVITE_NOT_VALID', { state: 'used' })
      }

      /**
       * Refuse to activate a soft-deleted account. An admin may have deleted the
       * invitee between the link being sent and opened; deleteUser now revokes the
       * invitation, but this is the defence at the write itself — flipping a
       * `deletedAt`-set row to ACTIVE would produce an account that appears active
       * yet cannot log in.
       */
      const live = await tx.user.findFirst({
        where: { id: full.createdUserId!, deletedAt: null },
        select: { id: true },
      })
      if (!live) {
        throw new PreconditionFailedError('INVITE_NOT_VALID', { state: 'revoked' })
      }

      const user = await tx.user.update({
        where: { id: full.createdUserId! },
        data: {
          name: input.name,
          passwordHash,
          status: 'ACTIVE',
          passwordChangedAt: now,
          // Invalidate anything issued against the INVITED state.
          sessionEpoch: { increment: 1 },
          failedLoginCount: 0,
          lockedUntil: null,
        },
        select: { id: true, email: true, name: true, organizationId: true, sessionEpoch: true },
      })

      const grants = (full.projectGrants ?? []) as Array<{ projectId: string; roleId: string }>
      if (grants.length > 0) {
        await tx.membership.createMany({
          data: grants.map((grant) => ({
            organizationId: user.organizationId,
            userId: user.id,
            projectId: grant.projectId,
            roleId: grant.roleId,
            createdById: user.id,
          })),
        })
      }

      // The invitation was already marked ACCEPTED by the compare-and-set above.

      await audit.recordSystem(tx, user.organizationId, AUDIT_ACTIONS.user.inviteAccepted, {
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.email,
        targetUserId: user.id,
        metadata: { ip: meta.ip, userAgent: meta.userAgent, projectGrants: grants.length },
        summary: `${user.name} accepted their invitation`,
        actorName: user.name,
      })

      return user
    })
  }

  async resend(ctx: RequestContext, invitationId: string) {
    requirePermission(ctx, PERMISSIONS.user.invite)

    const limit = await consume(RATE_LIMITS.inviteResend(invitationId))
    if (!limit.allowed) {
      throw new ValidationError('This invitation was re-sent recently. Try again in an hour.')
    }

    const invitation = await db.invitation.findFirst({
      where: { id: invitationId, organizationId: ctx.organizationId },
      select: { id: true, email: true, name: true, status: true, message: true, roleIds: true, sentCount: true },
    })

    if (!invitation) throw new NotFoundError('Invitation', invitationId)
    if (invitation.status !== 'PENDING') {
      throw new PreconditionFailedError('INVITE_NOT_VALID', { state: invitation.status })
    }

    const settings = await db.setting.findUnique({
      where: { organizationId: ctx.organizationId },
      select: { inviteExpiryHours: true },
    })
    const expiryHours = settings?.inviteExpiryHours ?? 72

    // A new token, which invalidates the previous one. Resending must not leave
    // two working links alive.
    const rawToken = generateToken()
    const roles = await db.role.findMany({
      where: { id: { in: invitation.roleIds } },
      select: { name: true },
    })

    await db.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + expiryHours * 3600_000),
          sentCount: { increment: 1 },
          lastSentAt: new Date(),
        },
      })

      await audit.record(tx, ctx, AUDIT_ACTIONS.user.inviteResent, {
        entityType: 'Invitation',
        entityId: invitation.id,
        entityLabel: invitation.email,
        metadata: { sentCount: invitation.sentCount + 1 },
      })

      await notifications.enqueue(
        {
          templateKey: 'user-invite',
          organizationId: ctx.organizationId,
          // Includes sentCount so each resend is a distinct queue entry.
          idempotencyKey: `invite:${invitation.id}:${invitation.sentCount + 1}`,
          recipients: [{ email: invitation.email, name: invitation.name ?? undefined }],
          payload: {
            email: invitation.email,
            inviterName: ctx.actorName,
            roleNames: roles.map((r) => r.name),
            expiresInHours: expiryHours,
            message: invitation.message,
            acceptUrl: `${env.APP_URL}/accept-invite/${rawToken}`,
          },
          relatedEntityType: 'Invitation',
          relatedEntityId: invitation.id,
        },
        tx,
      )
    })
  }

  async revoke(ctx: RequestContext, invitationId: string) {
    requirePermission(ctx, PERMISSIONS.user.invite)

    const invitation = await db.invitation.findFirst({
      where: { id: invitationId, organizationId: ctx.organizationId },
      select: { id: true, email: true, status: true, createdUserId: true },
    })

    if (!invitation) throw new NotFoundError('Invitation', invitationId)
    if (invitation.status !== 'PENDING') {
      throw new PreconditionFailedError('INVITE_NOT_VALID', { state: invitation.status })
    }

    await db.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'REVOKED', revokedAt: new Date(), revokedById: ctx.actorId },
      })

      // The placeholder user has never signed in, so soft-delete it too — leaving
      // an orphaned INVITED row makes the admin user list lie.
      if (invitation.createdUserId) {
        await tx.user.updateMany({
          where: { id: invitation.createdUserId, status: 'INVITED' },
          data: { deletedAt: new Date(), status: 'DEACTIVATED' },
        })
      }

      await audit.record(tx, ctx, AUDIT_ACTIONS.user.inviteRevoked, {
        entityType: 'Invitation',
        entityId: invitation.id,
        entityLabel: invitation.email,
        targetUserId: invitation.createdUserId,
      })
    })
  }

  /**
   * Refuse to grant permissions the actor does not themselves hold.
   *
   * Without this, `user.invite` is a privilege-escalation primitive: invite a
   * throwaway address as Admin, accept it, and you have bypassed every other
   * control. Super-admins are exempt because they already hold everything.
   */
  private assertNoEscalation(
    ctx: RequestContext,
    roles: readonly { name: string; permissions: string[] }[],
  ): void {
    if (ctx.permissions.isSuperAdmin) return

    for (const role of roles) {
      for (const permission of role.permissions) {
        if (permission === '*' || !ctx.permissions.global.has(permission)) {
          throw new ValidationError(
            `You cannot grant "${role.name}" because it includes permissions you do not hold.`,
            { roleIds: [`"${role.name}" exceeds your own access`] },
          )
        }
      }
    }
  }
}

export const invitationService = new InvitationService()
