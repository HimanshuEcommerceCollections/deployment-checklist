import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { db } from '@/lib/db/prisma'

/**
 * What the outbox worker does when email is switched off.
 *
 * The guarantee being tested: switching email off loses nothing. Rows are still
 * written inside the caller's transaction, still carry their payload, and are
 * still retryable the moment a provider exists — they are simply closed out with
 * a reason instead of being delivered.
 *
 * Anything else would be worse than not sending. Leaving them PENDING means the
 * worker retries configuration until it dead-letters, and a queue full of rows
 * that failed for policy reasons is indistinguishable from a provider outage.
 */

let organizationId: string
const keys: string[] = []

/** A dispatcher loaded against a specific environment. env.ts caches, so this reloads. */
async function loadDispatcher(overrides: Record<string, string>) {
  vi.resetModules()
  vi.stubEnv('EMAIL_CONFIG_SOURCE', 'env')
  vi.stubEnv('EMAIL_PROVIDER', 'console')
  vi.stubEnv('NODE_ENV', 'development')
  for (const [key, value] of Object.entries(overrides)) {
    vi.stubEnv(key, value)
  }
  const { notifications } = await import('@/lib/notifications/dispatcher')
  return notifications
}

function probe(name: string) {
  const key = `test:email-outbox:${name}:${process.pid}`
  keys.push(key)
  return key
}

type Dispatcher = Awaited<ReturnType<typeof loadDispatcher>>

async function enqueueReset(notifications: Dispatcher, idempotencyKey: string) {
  await notifications.enqueue({
    templateKey: 'password-reset',
    organizationId,
    idempotencyKey,
    recipients: [{ email: 'probe@example.com', name: 'Probe' }],
    payload: {
      email: 'probe@example.com',
      resetUrl: 'http://localhost:3000/reset-password/PROBE-TOKEN',
      expiresInMinutes: 30,
      requestIp: null,
    },
  })
}

/**
 * Drain until our row has been processed, rather than once.
 *
 * `drain` takes the 50 oldest due rows, and the seed leaves a backlog of queued
 * invitations. A single drain can therefore finish without ever reaching a row
 * enqueued a moment ago, which makes a one-shot assertion pass or fail depending
 * on how much unrelated work is sitting in the queue.
 */
async function drainUntilProcessed(notifications: Dispatcher, idempotencyKey: string) {
  const totals = { claimed: 0, sent: 0, failed: 0, dead: 0 }

  for (let pass = 0; pass < 20; pass += 1) {
    const result = await notifications.drain({ batchSize: 50 })
    totals.claimed += result.claimed
    totals.sent += result.sent
    totals.failed += result.failed
    totals.dead += result.dead

    const row = await db.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey },
      select: { status: true },
    })
    if (row.status !== 'PENDING') return totals

    // Nothing left to claim and our row is still pending: draining more will not
    // change that, so fail loudly here instead of timing out.
    if (result.claimed === 0) {
      throw new Error(`drain claimed nothing while ${idempotencyKey} was still PENDING`)
    }
  }

  throw new Error(`${idempotencyKey} was never processed after 20 drain passes`)
}

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ select: { id: true } })
  organizationId = organization.id
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

afterAll(async () => {
  await db.notificationOutbox.deleteMany({ where: { idempotencyKey: { in: keys } } })
})

describe('outbox drain with EMAIL_ENABLED=false', () => {
  it('queues the notification, then dead-letters it as recoverable rather than losing it', async () => {
    const notifications = await loadDispatcher({ EMAIL_ENABLED: 'false' })
    const key = probe('disabled')

    await enqueueReset(notifications, key)

    // Queued despite email being off — this is what makes it recoverable later.
    const queued = await db.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: key },
      select: { status: true, payload: true },
    })
    expect(queued.status).toBe('PENDING')

    await drainUntilProcessed(notifications, key)

    const row = await db.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: key },
      select: { status: true, providerMessageId: true, lastError: true, payload: true },
    })

    // DEAD, not SENT: it was never delivered. SENT would have been pruned by the
    // 30-day TTL and refused by the admin retry, silently losing the notification.
    // DEAD is retryable the moment a provider is configured.
    expect(row.status).toBe('DEAD')
    // Nothing was actually handed to a transport.
    expect(row.providerMessageId).toBeNull()
    expect(row.lastError).toContain('EMAIL_ENABLED=false')
    // The payload survives, so the row is still retryable once a provider exists.
    expect(row.payload).toMatchObject({ email: 'probe@example.com' })
  })

  it('parks the skipped row as dead-lettered, not as a transient failure', async () => {
    const notifications = await loadDispatcher({ EMAIL_ENABLED: 'false' })
    const key = probe('not-failed')

    await enqueueReset(notifications, key)
    const totals = await drainUntilProcessed(notifications, key)

    // Terminal-but-recoverable, so it does not retry-spin: dead once, never failed.
    expect(totals.failed).toBe(0)
    expect(totals.dead).toBe(1)
  })
})

describe('outbox drain with EMAIL_ENABLED=true', () => {
  it('delivers through the configured provider', async () => {
    const notifications = await loadDispatcher({ EMAIL_ENABLED: 'true' })
    const key = probe('enabled')

    await enqueueReset(notifications, key)
    await drainUntilProcessed(notifications, key)

    const row = await db.notificationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: key },
      select: { status: true, provider: true, providerMessageId: true, lastError: true },
    })

    expect(row.status).toBe('SENT')
    expect(row.provider).toBe('console')
    expect(row.providerMessageId).toMatch(/^console-/)
    expect(row.lastError).toBeNull()
  })
})

describe('outbox drain and a stranded SENDING lock', () => {
  const statusOf = async (idempotencyKey: string) =>
    (
      await db.notificationOutbox.findUniqueOrThrow({
        where: { idempotencyKey },
        select: { status: true },
      })
    ).status

  it('reclaims a SENDING row whose worker died mid-send and delivers it', async () => {
    const notifications = await loadDispatcher({ EMAIL_ENABLED: 'true' })
    const key = probe('stranded')

    await enqueueReset(notifications, key)

    // Simulate a worker that claimed the row then died: SENDING, lock long past.
    // Nothing sweeps such a row before this fix — drain only saw PENDING/FAILED
    // and the admin retry only accepts FAILED/DEAD, so it was stuck forever.
    await db.notificationOutbox.update({
      where: { idempotencyKey: key },
      data: {
        status: 'SENDING',
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
        lockedBy: 'dead-worker',
        attempts: 1,
      },
    })

    let status = 'SENDING'
    for (let pass = 0; pass < 20 && status !== 'SENT'; pass += 1) {
      await notifications.drain({ batchSize: 50 })
      status = await statusOf(key)
    }
    expect(status).toBe('SENT')
  })

  it('does not steal a fresh SENDING lock from a live worker', async () => {
    const notifications = await loadDispatcher({ EMAIL_ENABLED: 'true' })
    const key = probe('fresh-lock')

    await enqueueReset(notifications, key)
    await db.notificationOutbox.update({
      where: { idempotencyKey: key },
      data: { status: 'SENDING', lockedAt: new Date(), lockedBy: 'live-worker', attempts: 1 },
    })

    // A single drain must not touch a lock held moments ago — that would race a
    // worker mid-send and double-deliver.
    await notifications.drain({ batchSize: 50 })
    expect(await statusOf(key)).toBe('SENDING')
  })
})
