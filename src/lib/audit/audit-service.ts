import 'server-only'

import type { Prisma } from '@prisma/client'

import { type AuditChange, diff, redactChanges, redactObject } from '@/domain/audit/diff'
import type { RequestContext } from '@/lib/authz/authorize'
import { db, type TxClient } from '@/lib/db/prisma'
import { logger } from '@/lib/logger'

import { ALWAYS_LOG, type AuditAction } from './actions'

/**
 * Audit recording.
 *
 * Written by the SERVICE layer, not by Prisma middleware. A middleware hook can
 * see that `deployment_runs` changed; it cannot know this was a *completion*,
 * who decided it, or why. Meaningful audit needs intent, and intent only exists
 * where the use case is expressed.
 *
 * Two write paths, chosen per action:
 *
 *   record(tx, …)          inside the caller's transaction. The entry exists if
 *                          and only if the state change committed. Used for
 *                          transitions, permission changes, settings changes.
 *
 *   recordDeferred(…)      after() / post-response. Used for high-volume,
 *                          low-stakes entries (item toggles). Trade-off is
 *                          explicit: a crash between response and after() loses
 *                          one entry.
 */

/**
 * Anything that can write an audit row — the root client or a transaction client.
 *
 * Narrowed to the one model this service touches, so a caller can see from the
 * signature that passing a transaction is supported and nothing else is written.
 */
export type AuditWriter = Pick<TxClient, 'auditLog'>

export interface AuditInput {
  entityType: string
  entityId?: string | null
  /** Human-readable snapshot, e.g. "APEX-142". Kept so history reads well. */
  entityLabel?: string | null

  projectId?: string | null
  deploymentId?: string | null
  templateId?: string | null
  targetUserId?: string | null

  /** Provide before+after for an automatic diff… */
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  trackedFields?: readonly string[]
  /** …or a pre-computed change set. */
  changes?: readonly AuditChange[]

  metadata?: Record<string, unknown>
  /** Overrides the generated sentence. */
  summary?: string
}

export class AuditService {
  /**
   * Atomic write. Pass the transaction client from the caller's $transaction.
   */
  async record(
    writer: AuditWriter,
    ctx: RequestContext,
    action: AuditAction,
    input: AuditInput,
  ): Promise<void> {
    const changes = this.resolveChanges(input)

    // Nothing changed → nothing to record. Without this, every no-op form save
    // adds a row and the trail becomes unreadable noise.
    if (changes && changes.length === 0 && !ALWAYS_LOG.has(action)) return

    await writer.auditLog.create({
      data: {
        action,
        organizationId: ctx.organizationId,

        // Actor identity is FROZEN here, never referenced. If someone is renamed
        // or deleted, this entry must still read as it did when written.
        actorId: ctx.actorType === 'user' ? ctx.actorId : null,
        actorEmail: ctx.actorEmail,
        actorName: ctx.actorName,
        actorRoles: [...ctx.roleKeys],
        actorType: ctx.actorType,

        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel?.slice(0, 200) ?? null,

        projectId: input.projectId ?? null,
        deploymentId: input.deploymentId ?? null,
        templateId: input.templateId ?? null,
        targetUserId: input.targetUserId ?? null,

        changes: changes && changes.length > 0 ? (changes as unknown as Prisma.InputJsonValue) : undefined,
        metadata: input.metadata
          ? (redactObject(input.metadata) as Prisma.InputJsonValue)
          : undefined,
        summary: input.summary ?? this.renderSummary(ctx, action, input),

        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent?.slice(0, 400) ?? null,
        requestId: ctx.requestId,
        correlationId: ctx.requestId,
      },
    })
  }

  /**
   * Deferred, non-transactional write for post-response use.
   *
   * A failure here must NEVER surface to the user — the state change already
   * committed. Logged at error level for alerting instead.
   */
  async recordDeferred(ctx: RequestContext, action: AuditAction, input: AuditInput): Promise<void> {
    try {
      await this.record(db, ctx, action, input)
    } catch (error) {
      logger.error(
        { err: error, action, requestId: ctx.requestId, entityId: input.entityId },
        'audit write failed',
      )
    }
  }

  /**
   * System-actor write for jobs, migrations and the seed, which have no request
   * context. `organizationId` is explicit because background work runs outside
   * the ALS scope and must not inherit a tenant by accident.
   */
  async recordSystem(
    writer: AuditWriter,
    organizationId: string,
    action: AuditAction,
    input: AuditInput & { actorName?: string },
  ): Promise<void> {
    await writer.auditLog.create({
      data: {
        action,
        organizationId,
        actorId: null,
        actorEmail: null,
        actorName: input.actorName ?? 'System',
        actorRoles: [],
        actorType: 'system',
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        entityLabel: input.entityLabel?.slice(0, 200) ?? null,
        projectId: input.projectId ?? null,
        deploymentId: input.deploymentId ?? null,
        templateId: input.templateId ?? null,
        targetUserId: input.targetUserId ?? null,
        changes: input.changes?.length
          ? (redactChanges(input.changes) as unknown as Prisma.InputJsonValue)
          : undefined,
        metadata: input.metadata
          ? (redactObject(input.metadata) as Prisma.InputJsonValue)
          : undefined,
        summary: input.summary ?? `System: ${action}`,
        requestId: 'system',
        correlationId: 'system',
      },
    })
  }

  private resolveChanges(input: AuditInput): AuditChange[] | undefined {
    if (input.changes) return redactChanges(input.changes)
    if (input.before && input.after) {
      return redactChanges(
        diff(input.before, input.after, input.trackedFields as readonly string[] | undefined),
      )
    }
    return undefined
  }

  /**
   * Fallback sentence for the activity feed.
   *
   * Services pass an explicit `summary` for anything user-facing; this keeps the
   * feed readable when they do not, rather than showing a raw action code.
   */
  private renderSummary(ctx: RequestContext, action: AuditAction, input: AuditInput): string {
    const actor = ctx.actorName || ctx.actorEmail || 'Someone'
    const verb = action.split('.').slice(1).join(' ').replace(/_/g, ' ')
    const target = input.entityLabel ? ` "${input.entityLabel}"` : ''
    return `${actor} ${verb}${target}`.trim()
  }
}

export const audit = new AuditService()
