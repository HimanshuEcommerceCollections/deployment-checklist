import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { CreateIntegrationInput, UpdateIntegrationInput } from '../schemas/integrations.schema'

export class IntegrationsService {
  async listIntegrations(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    /// secretRef is deliberately omitted — ciphertext envelopes never leave the server.
    return db.integration.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        type: true,
        name: true,
        config: true,
        enabled: true,
        lastDeliveryAt: true,
        lastDeliveryStatus: true,
        lastError: true,
        failureCount: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createIntegration(ctx: RequestContext, input: CreateIntegrationInput) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    const integration = await db.integration.create({
      data: {
        organizationId: ctx.organizationId,
        type: input.type,
        name: input.name,
        config: input.config,
        enabled: input.enabled,
        createdById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.integration.created, {
      entityType: 'Integration',
      entityId: integration.id,
      entityLabel: integration.name,
    })

    return integration
  }

  async updateIntegration(ctx: RequestContext, id: string, input: UpdateIntegrationInput) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    const integration = await db.integration.update({
      where: { id },
      data: {
        type: input.type,
        name: input.name,
        config: input.config,
        enabled: input.enabled,
        updatedById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.integration.updated, {
      entityType: 'Integration',
      entityId: integration.id,
      entityLabel: integration.name,
    })

    return integration
  }

  async deleteIntegration(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    const integration = await db.integration.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.integration.deleted, {
      entityType: 'Integration',
      entityId: integration.id,
      entityLabel: integration.name,
    })

    return integration
  }
}

export const integrationsService = new IntegrationsService()
