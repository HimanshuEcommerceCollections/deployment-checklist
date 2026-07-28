import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateEnvironmentInput, UpdateEnvironmentInput } from '../schemas/environments.schema'

export class EnvironmentsService {
  async listEnvironments(ctx: RequestContext) {
    return db.environment.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      orderBy: { order: 'asc' },
    })
  }

  async getEnvironment(ctx: RequestContext, id: string) {
    return db.environment.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
    })
  }

  async createEnvironment(ctx: RequestContext, input: CreateEnvironmentInput) {
    requirePermission(ctx, PERMISSIONS.environment.create)

    const env = await db.environment.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        key: input.key,
        color: input.color,
        isProduction: input.isProduction,
        order: input.order,
        createdById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.environment.created, {
      entityType: 'Environment',
      entityId: env.id,
      entityLabel: env.name,
      summary: `${ctx.actorName} created environment "${env.name}"`,
    })

    return env
  }

  async updateEnvironment(ctx: RequestContext, id: string, input: UpdateEnvironmentInput) {
    requirePermission(ctx, PERMISSIONS.environment.edit)

    const env = await db.environment.update({
      where: { id },
      data: {
        name: input.name,
        key: input.key,
        color: input.color,
        isProduction: input.isProduction,
        order: input.order,
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.environment.updated, {
      entityType: 'Environment',
      entityId: env.id,
      entityLabel: env.name,
      summary: `${ctx.actorName} updated environment "${env.name}"`,
    })

    return env
  }

  async deleteEnvironment(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.environment.delete)

    const env = await db.environment.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.environment.deleted, {
      entityType: 'Environment',
      entityId: env.id,
      entityLabel: env.name,
      summary: `${ctx.actorName} deleted environment "${env.name}"`,
    })

    return env
  }
}

export const environmentsService = new EnvironmentsService()
