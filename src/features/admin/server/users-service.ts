import 'server-only'

import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import { invitationService } from '@/features/auth/server/invitation-service'

import type { InviteUserInput, UpdateUserInput } from '../schemas/users.schema'

export class UsersService {
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

  async deleteUser(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.edit)

    return db.user.update({
      where: { id: userId },
      data: { deletedAt: new Date(), status: 'DEACTIVATED', updatedById: ctx.actorId },
    })
  }
}

export const usersService = new UsersService()
