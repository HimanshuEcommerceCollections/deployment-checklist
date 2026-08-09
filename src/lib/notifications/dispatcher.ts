import 'server-only'

import type { Prisma } from '@prisma/client'

import { env } from '@/lib/config/env'
import { isUniqueViolation } from '@/lib/db/errors'
import { db, type TxClient } from '@/lib/db/prisma'
import { logger } from '@/lib/logger'

import {
  describeEmailDisabled,
  emailConfigFromSettings,
  resolveEmailProviderSafely,
} from './registry'
import { HtmlEmailRenderer } from './renderer'
import {
  EmailDeliveryError,
  type EmailAddress,
  type NotificationRequest,
  type NotificationTemplateKey,
} from './types'

/**
 * Transactional-outbox dispatcher.
 *
 * Business code calls `enqueue()` INSIDE its own transaction and never touches a
 * provider. The guarantee: either the state change committed and the
 * notification is queued, or neither happened. There is no window where a
 * deployment is marked complete but the email was lost, and none where an email
 * announces something that got rolled back.
 *
 * A worker (`/api/cron/outbox`) drains the queue. That buys retries with
 * backoff, idempotency, survival across provider outages, and — importantly —
 * zero user-visible latency from an SMTP handshake.
 */

/** The root client or a transaction client, narrowed to the outbox model. */
type OutboxWriter = Pick<TxClient, 'notificationOutbox'>

/**
 * How long a SENDING lock may be held before another drain reclaims it. Longer
 * than any legitimate send (the cron caps at 60s, one SMTP send can take ~40s),
 * short enough that a crash-stranded row recovers within a couple of cron ticks.
 */
const STALE_LOCK_MS = 5 * 60 * 1000

export class NotificationDispatcher {
  /**
   * Queue a notification. Does NOT send.
   *
   * Pass `tx` when enqueueing alongside a state change, which is almost always.
   */
  async enqueue(request: NotificationRequest, tx?: OutboxWriter): Promise<void> {
    const writer = tx ?? db

    try {
      await writer.notificationOutbox.create({
        data: {
          organizationId: request.organizationId,
          channel: 'EMAIL',
          templateKey: request.templateKey,
          payload: request.payload as Prisma.InputJsonValue,
          toAddresses: request.recipients.map((r) => r.email).filter((e): e is string => Boolean(e)),
          ccAddresses: [],
          bccAddresses: [],
          idempotencyKey: request.idempotencyKey,
          relatedEntityType: request.relatedEntityType ?? null,
          relatedEntityId: request.relatedEntityId ?? null,
          maxAttempts: 5,
        },
      })
    } catch (error) {
      // Unique violation on idempotencyKey means this notification is already
      // queued. That is the guarantee working, not a failure — a retried request
      // must not produce a second email.
      if (isUniqueViolation(error)) {
        logger.debug(
          { idempotencyKey: request.idempotencyKey },
          'notification already queued — skipping duplicate',
        )
        return
      }
      throw error
    }
  }

  /**
   * Worker entrypoint: claim due rows, deliver, apply backoff.
   *
   * Claiming BEFORE sending is essential. Cron platforms deliver at-least-once,
   * so two invocations can overlap, and an unclaimed row processed twice sends
   * the email twice.
   */
  async drain(options: { batchSize?: number; now?: Date } = {}): Promise<{
    claimed: number
    sent: number
    failed: number
    dead: number
  }> {
    const batchSize = options.batchSize ?? 25
    const now = options.now ?? new Date()
    const workerId = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`

    /**
     * A row is claimed by flipping it to SENDING before delivery. If the worker
     * then dies (a Vercel invocation timeout mid-batch is the realistic case —
     * one slow SMTP send can exceed the 60s cap), the row is stranded in SENDING:
     * drain only looked at PENDING/FAILED and the admin retry only accepts
     * FAILED/DEAD, so nothing ever picked it up again. Reclaim a SENDING row whose
     * lock is older than this threshold — comfortably past any legitimate send.
     */
    const staleLock = new Date(now.getTime() - STALE_LOCK_MS)

    const due = await db.notificationOutbox.findMany({
      where: {
        OR: [
          { status: { in: ['PENDING', 'FAILED'] }, nextAttemptAt: { lte: now } },
          { status: 'SENDING', lockedAt: { lte: staleLock } },
        ],
      },
      orderBy: { nextAttemptAt: 'asc' },
      take: batchSize,
      select: { id: true },
    })

    if (due.length === 0) return { claimed: 0, sent: 0, failed: 0, dead: 0 }

    // Claim each row conditionally. `count === 0` means another worker got it
    // first (or already reclaimed a stale lock, moving lockedAt to now), so we
    // skip rather than double-send.
    const claimedIds: string[] = []
    for (const row of due) {
      const { count } = await db.notificationOutbox.updateMany({
        where: {
          id: row.id,
          OR: [
            { status: { in: ['PENDING', 'FAILED'] } },
            { status: 'SENDING', lockedAt: { lte: staleLock } },
          ],
        },
        data: { status: 'SENDING', lockedAt: now, lockedBy: workerId, attempts: { increment: 1 } },
      })
      if (count > 0) claimedIds.push(row.id)
    }

    if (claimedIds.length === 0) return { claimed: 0, sent: 0, failed: 0, dead: 0 }

    const rows = await db.notificationOutbox.findMany({ where: { id: { in: claimedIds } } })

    let sent = 0
    let failed = 0
    let dead = 0

    for (const row of rows) {
      try {
        await this.deliver(row)
        sent += 1
      } catch (error) {
        const retryable = error instanceof EmailDeliveryError ? error.options.retryable : true
        const exhausted = row.attempts >= row.maxAttempts

        if (!retryable || exhausted) {
          await this.markDead(row.id, error)
          dead += 1
          logger.error(
            { outboxId: row.id, templateKey: row.templateKey, attempts: row.attempts, err: error },
            'notification dead-lettered — visible in the admin outbox for manual retry',
          )
        } else {
          await this.scheduleRetry(row.id, row.attempts, now, error)
          failed += 1
        }
      }
    }

    return { claimed: claimedIds.length, sent, failed, dead }
  }

  /** Admin action for a FAILED or DEAD row. */
  async retry(outboxId: string): Promise<void> {
    await db.notificationOutbox.update({
      where: { id: outboxId },
      data: { status: 'PENDING', nextAttemptAt: new Date(), attempts: 0, lastError: null },
    })
  }

  // -------------------------------------------------------------------------

  private async deliver(row: {
    id: string
    organizationId: string
    templateKey: string
    payload: Prisma.JsonValue
    toAddresses: string[]
  }): Promise<void> {
    const settings = await db.setting.findUnique({
      where: { organizationId: row.organizationId },
      select: {
        companyName: true,
        supportEmail: true,
        primaryColor: true,
        emailProvider: true,
        emailEnabled: true,
        emailFromAddr: true,
        emailFromName: true,
        emailReplyTo: true,
        smtpHost: true,
        smtpPort: true,
        smtpSecure: true,
        smtpUsername: true,
        smtpSecretRef: true,
        emailApiKeyRef: true,
        emailDailyCap: true,
      },
    })

    const config = emailConfigFromSettings(settings)

    // Off by EMAIL_ENABLED (deployment) or Setting.emailEnabled (admin). Parked
    // as DEAD rather than SENT: it was never delivered, so marking it SENT was a
    // lie that also made it unrecoverable — the 30-day TTL prunes SENT rows and
    // the admin retry refuses them, so a notification queued during a disabled
    // window was silently lost. DEAD is not delivered, not pruned, and the retry
    // route accepts it — so the moment a provider is configured, an admin can
    // replay it. It is thrown as a non-retryable error so the standard drain path
    // records it, rather than being closed out here as success.
    if (!config.enabled) {
      throw new EmailDeliveryError(describeEmailDisabled(settings), {
        retryable: false,
        provider: 'disabled',
      })
    }

    if (row.toAddresses.length === 0) {
      throw new EmailDeliveryError('No recipients', { retryable: false, provider: 'unknown' })
    }

    const provider = resolveEmailProviderSafely(config)

    const renderer = new HtmlEmailRenderer({
      companyName: settings?.companyName ?? 'Deployment Checklist',
      supportEmail: settings?.supportEmail ?? undefined,
      primaryColor: settings?.primaryColor ?? '#1a7f9c',
      appUrl: env.APP_URL,
    })

    const rendered = await renderer.render(
      row.templateKey as NotificationTemplateKey,
      row.payload as Record<string, unknown>,
    )

    const from: EmailAddress = {
      email: config.fromAddress,
      name: config.fromName,
    }

    const result = await provider.send({
      to: row.toAddresses.map((email) => ({ email })),
      from,
      replyTo: config.replyTo ? { email: config.replyTo } : undefined,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })

    await db.notificationOutbox.update({
      where: { id: row.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        provider: result.provider,
        providerMessageId: result.messageId,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    })
  }

  /**
   * Exponential backoff with jitter: ~1m, 2m, 4m, 8m, 16m (capped).
   *
   * Jitter matters — without it, every notification queued during an outage
   * retries at the same instant when the provider recovers, which is a
   * self-inflicted thundering herd against a service that just came back.
   */
  private async scheduleRetry(id: string, attempts: number, now: Date, error: unknown) {
    const baseMs = Math.min(2 ** attempts * 60_000, 16 * 60_000)
    const jitterMs = Math.floor(Math.random() * 30_000)

    await db.notificationOutbox.update({
      where: { id },
      data: {
        status: 'FAILED',
        nextAttemptAt: new Date(now.getTime() + baseMs + jitterMs),
        lastError: truncateError(error),
        lockedAt: null,
        lockedBy: null,
      },
    })
  }

  private async markDead(id: string, error: unknown) {
    await db.notificationOutbox.update({
      where: { id },
      data: {
        status: 'DEAD',
        lastError: truncateError(error),
        lockedAt: null,
        lockedBy: null,
      },
    })
  }
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 1_000)
}

export const notifications = new NotificationDispatcher()
