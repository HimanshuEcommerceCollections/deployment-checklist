import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { type RequestContext } from '@/lib/authz/authorize'
import { db } from '@/lib/db/prisma'

import type { UpdateProfileInput, ChangePasswordInput } from '../schemas/profile.schema'

export class ProfileService {
  async getProfile(ctx: RequestContext) {
    return db.user.findUniqueOrThrow({
      where: { id: ctx.actorId },
      select: { id: true, name: true, email: true, jobTitle: true, createdAt: true },
    })
  }

  async updateProfile(ctx: RequestContext, input: UpdateProfileInput) {
    // User.email is globally unique and stored lowercased — a mixed-case write
    // would silently break the login lookup.
    const email = input.email?.trim().toLowerCase()

    if (email) {
      const taken = await db.user.findFirst({
        where: { email, id: { not: ctx.actorId } },
        select: { id: true },
      })
      if (taken) throw new Error('That email address is already in use.')
    }

    const user = await db.user.update({
      where: { id: ctx.actorId },
      data: {
        name: input.name,
        email,
        jobTitle: input.jobTitle,
        updatedById: ctx.actorId,
      },
      select: { id: true, name: true, email: true, jobTitle: true },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.user.profileUpdated, {
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.name,
      summary: `${ctx.actorName} updated their profile`,
    })

    return user
  }

  async changePassword(ctx: RequestContext, input: ChangePasswordInput) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: ctx.actorId },
      select: { id: true, passwordHash: true },
    })

    const valid = await verifyPassword(user.passwordHash, input.currentPassword)
    if (!valid) {
      throw new Error('Your current password is incorrect.')
    }

    if (await verifyPassword(user.passwordHash, input.newPassword)) {
      throw new Error('Your new password must be different from your current one.')
    }

    await db.user.update({
      where: { id: ctx.actorId },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        passwordChangedAt: new Date(),
        // Invalidates every JWT issued before now — see User.sessionEpoch.
        sessionEpoch: { increment: 1 },
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.auth.passwordChanged, {
      entityType: 'User',
      entityId: ctx.actorId,
      entityLabel: ctx.actorName,
      summary: `${ctx.actorName} changed their password`,
    })

    return { ok: true }
  }
}

export const profileService = new ProfileService()
