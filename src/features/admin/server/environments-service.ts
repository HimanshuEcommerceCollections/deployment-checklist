import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateEnvironmentInput, UpdateEnvironmentInput } from '../schemas/environments.schema'

export class EnvironmentsService {
  /**
   * Resolve inside the tenant before any write.
   *
   * `update({ where: { id } })` checks nothing but the id, so without this an
   * actor holding `environment.manage` in one organization could rename or
   * delete another organization's environment by id alone.
   */
  private async assertInTenant(ctx: RequestContext, id: string) {
    return db.environment.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, key: true, name: true },
    })
  }

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
    requirePermission(ctx, PERMISSIONS.environment.manage)

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
    requirePermission(ctx, PERMISSIONS.environment.manage)
    await this.assertInTenant(ctx, id)

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
    requirePermission(ctx, PERMISSIONS.environment.manage)
    await this.assertInTenant(ctx, id)

    /// A deployment run records the environment it targeted. Deleting one that
    /// is still referenced would leave those runs pointing at a row no read can
    /// see, so refuse rather than corrupt the history.
    const inUse = await db.deploymentRun.count({
      where: { organizationId: ctx.organizationId, environmentId: id, deletedAt: null },
    })

    if (inUse > 0) {
      throw new Error(
        `This environment is used by ${inUse} deployment${inUse === 1 ? '' : 's'} and cannot be deleted.`,
      )
    }

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

  async restoreEnvironment(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.environment.manage)

    const deleted = await db.environment.findFirstOrThrow({
      where: { id, organizationId: ctx.organizationId, deletedAt: { not: null } },
      select: { id: true, key: true, name: true },
    })

    /**
     * Normally unreachable, and kept anyway — same reasoning as restoreProject.
     * `@@unique([organizationId, key])` ignores deletedAt, so this environment
     * still holds its key while in the trash. A clear message beats an opaque
     * index violation if that ever changes. Environments are named by operators
     * rather than derived, so this asks rather than renaming behind their back.
     */
    const clash = await db.environment.findFirst({
      where: { organizationId: ctx.organizationId, key: deleted.key, deletedAt: null },
      select: { id: true },
    })

    if (clash) {
      throw new Error(
        `An active environment already uses the key "${deleted.key}". Rename it before restoring this one.`,
      )
    }

    const env = await db.environment.update({
      where: { id: deleted.id },
      data: { deletedAt: null, updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.environment.restored, {
      entityType: 'Environment',
      entityId: env.id,
      entityLabel: env.name,
      summary: `${ctx.actorName} restored environment "${env.name}"`,
    })

    return env
  }
}

export const environmentsService = new EnvironmentsService()
