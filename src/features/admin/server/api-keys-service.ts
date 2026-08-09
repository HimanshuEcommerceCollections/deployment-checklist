import 'server-only'

import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { NotFoundError } from '@/domain/shared/errors'
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
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createApiKey(ctx: RequestContext, input: CreateApiKeyInput) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    /// prefix is stored in plaintext for display, so it must be independent of
    /// the secret — deriving it from the token would leak part of the credential.
    const prefix = `dc_${crypto.randomBytes(4).toString('hex')}`
    const secret = crypto.randomBytes(32).toString('base64url')
    const token = `${prefix}_${secret}`
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

    /**
     * Scope by a filtered read first. `update({ where: { id } })` checks only the
     * id — neither the tenant extension nor the soft-delete extension narrows a
     * unique-id write — so without this an admin of one organization could revoke
     * another organization's key by id. This is the pattern every other service
     * uses; it was missing here.
     */
    const existing = await db.apiKey.findFirst({
      where: { id: keyId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    })
    if (!existing) throw new NotFoundError('ApiKey', keyId)

    const apiKey = await db.apiKey.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedById: ctx.actorId },
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
