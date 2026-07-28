import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { AddMemberInput, UpdateMemberInput } from '../schemas/members.schema'

export class MembersService {
  async listProjectMembers(ctx: RequestContext, projectId: string) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)

    return db.membership.findMany({
      where: { projectId, deletedAt: null },
      include: { user: true, roles: true },
      orderBy: { user: { name: 'asc' } },
    })
  }

  async addMember(ctx: RequestContext, projectId: string, input: AddMemberInput) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)

    const membership = await db.membership.create({
      data: {
        projectId,
        userId: input.userId,
        roles: {
          connect: input.roleIds.map((id) => ({ id })),
        },
        createdById: ctx.actorId,
      },
      include: { user: true },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberAdded, {
      entityType: 'Membership',
      entityId: membership.id,
      entityLabel: membership.user.name,
    })

    return membership
  }

  async updateMember(ctx: RequestContext, membershipId: string, input: UpdateMemberInput) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)

    const membership = await db.membership.update({
      where: { id: membershipId },
      data: {
        roles: {
          set: input.roleIds.map((id) => ({ id })),
        },
        updatedById: ctx.actorId,
      },
      include: { user: true },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberUpdated, {
      entityType: 'Membership',
      entityId: membership.id,
      entityLabel: membership.user.name,
    })

    return membership
  }

  async removeMember(ctx: RequestContext, membershipId: string) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)

    const membership = await db.membership.update({
      where: { id: membershipId },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
      include: { user: true },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberRemoved, {
      entityType: 'Membership',
      entityId: membership.id,
      entityLabel: membership.user.name,
    })

    return membership
  }
}

export const membersService = new MembersService()
