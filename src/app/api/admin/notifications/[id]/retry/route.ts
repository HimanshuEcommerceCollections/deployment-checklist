import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit/audit-service'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { env } from '@/lib/config/env'
import { db } from '@/lib/db/prisma'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications/dispatcher'
import { getRequestContext } from '@/server/context'

/**
 * Requeue one outbox row. Target of the Retry button on the admin outbox page,
 * which posts a plain HTML form — so this redirects rather than returning JSON.
 *
 * It is also the manual send lever. On Hobby, where Vercel cron runs at most once
 * a day, this is how an admin gets a queued invitation out now.
 *
 * Node runtime because the request reaches Prisma and Argon2 through
 * getRequestContext().
 */
export const runtime = 'nodejs'

/** Rows that may be requeued. */
const RETRYABLE = new Set(['FAILED', 'DEAD'])

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params

  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.notification.retry)

  /**
   * Scoped read before the write. The tenant extension cannot narrow an
   * `update` by unique id — Prisma restricts that `where` to unique fields — and
   * route handlers run outside the ALS store, so nothing is injected here at all.
   * The explicit organizationId is the only thing standing between this and a
   * cross-tenant requeue.
   */
  const row = await db.notificationOutbox.findFirst({
    where: { id, organizationId: ctx.organizationId },
    select: { id: true, status: true, templateKey: true, toAddresses: true, attempts: true },
  })

  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  /**
   * A SENT row must never be requeued — that sends a second copy of an email
   * somebody already received, and the idempotency key cannot help because the
   * row it guards already exists. PENDING and SENDING are refused too: the first
   * is already due, and the second is mid-flight in another invocation.
   */
  if (!RETRYABLE.has(row.status)) {
    return NextResponse.json(
      { error: `Cannot retry a ${row.status} notification.` },
      { status: 409 },
    )
  }

  await notifications.retry(row.id)

  await audit.recordDeferred(ctx, AUDIT_ACTIONS.notification.retried, {
    entityType: 'NotificationOutbox',
    entityId: row.id,
    entityLabel: row.templateKey,
    metadata: {
      templateKey: row.templateKey,
      recipients: row.toAddresses,
      previousStatus: row.status,
      previousAttempts: row.attempts,
    },
    summary: `Requeued ${row.templateKey} notification (was ${row.status})`,
  })

  logger.info(
    { outboxId: row.id, templateKey: row.templateKey, previousStatus: row.status },
    'notification requeued by admin',
  )

  revalidatePath('/admin/notifications')

  // 303, not 302 — the browser must switch to GET for the redirect target.
  // A 302 leaves some clients re-POSTing, which requeues the row twice.
  return NextResponse.redirect(new URL('/admin/notifications', env.APP_URL), 303)
}
