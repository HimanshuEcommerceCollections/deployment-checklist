import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import crypto from 'crypto'

import type { CreateApiKeyInput } from '../schemas/api-keys.schema'

export class ApiKeysService {
  async listApiKeys(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    return db.apiKey.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createApiKey(ctx: RequestContext, input: CreateApiKeyInput) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    const token = crypto.randomBytes(32).toString('hex')
    const prefix = token.slice(0, 8)
    const hash = crypto.createHash('sha256').update(token).digest('hex')

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null

    const apiKey = await db.apiKey.create({
      data: {
        organizationId: ctx.organizationId,
        name: input.name,
        prefix,
        tokenHash: hash,
        scopes: input.scopes,
        expiresAt,
        createdById: ctx.actorId,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.apiKey.created, {
      entityType: 'ApiKey',
      entityId: apiKey.id,
      entityLabel: apiKey.name,
    })

    return { ...apiKey, token }
  }

  async revokeApiKey(ctx: RequestContext, keyId: string) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    const apiKey = await db.apiKey.update({
      where: { id: keyId },
      data: { deletedAt: new Date(), updatedById: ctx.actorId },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.apiKey.revoked, {
      entityType: 'ApiKey',
      entityId: apiKey.id,
      entityLabel: apiKey.name,
    })

    return apiKey
  }
}

export const apiKeysService = new ApiKeysService()
