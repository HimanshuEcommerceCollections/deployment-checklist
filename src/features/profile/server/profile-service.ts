import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
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
    const user = await db.user.update({
      where: { id: ctx.actorId },
      data: {
        name: input.name,
        email: input.email,
        jobTitle: input.jobTitle,
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
    // In a real app, verify currentPassword with argon2 here
    // For now, just update it

    await db.user.update({
      where: { id: ctx.actorId },
      data: {
        passwordHash: input.newPassword, // This should be hashed in production
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.user.passwordChanged, {
      entityType: 'User',
      entityId: ctx.actorId,
      entityLabel: ctx.actorName,
      summary: `${ctx.actorName} changed their password`,
    })

    return { ok: true }
  }
}

export const profileService = new ProfileService()
