import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import { env } from '@/lib/config/env'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications/dispatcher'

/**
 * Outbox worker — the thing that actually sends email.
 *
 * `enqueue()` writes a row inside the caller's transaction and deliberately never
 * touches a provider, so nothing is sent until this runs. Without it invitations
 * queue forever with `attempts=0`, which looks identical to a broken mail server.
 *
 * Node runtime is mandatory, not a preference: nodemailer opens a raw TCP socket
 * to smtp.gmail.com:465 and the Edge runtime has no sockets at all.
 *
 * `src/middleware.ts` already excludes `/api/cron` from its matcher — session
 * middleware would 302 every job, since this authenticates with CRON_SECRET
 * instead of a cookie.
 */
export const runtime = 'nodejs'
/** Never cached or statically evaluated — it has side effects by definition. */
export const dynamic = 'force-dynamic'
/**
 * Each Gmail send pays a fresh TCP+TLS handshake (~1-3s) because serverless
 * cannot pool connections across invocations. 60s is the Hobby ceiling and is
 * accepted on Pro too, so it is the portable choice.
 */
export const maxDuration = 60

/**
 * Deliberately small. At ~1-3s per send, 10 rows is roughly 30s worst case —
 * inside maxDuration with room to spare. A larger batch would be killed
 * mid-flight, and rows claimed as SENDING by a dead invocation are the one state
 * this queue cannot self-heal from without a reaper.
 */
const DEFAULT_BATCH_SIZE = 10
const MAX_BATCH_SIZE = 50

/**
 * Constant-time comparison. A length-varying `===` on a shared secret leaks it
 * one byte at a time to anyone who can measure the response.
 */
function secretMatches(candidate: string | null): boolean {
  if (!candidate) return false

  const expected = Buffer.from(env.CRON_SECRET)
  const provided = Buffer.from(candidate)

  // timingSafeEqual throws on a length mismatch, which is itself a leak — so
  // compare lengths first and always run the comparison against equal buffers.
  if (expected.length !== provided.length) return false

  return timingSafeEqual(expected, provided)
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically.
 * `x-cron-secret` is accepted as well so an external pinger — needed on Hobby,
 * where cron is capped at once a day — can drive this without faking a bearer
 * token.
 */
function isAuthorized(request: Request): boolean {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? null
  return secretMatches(bearer) || secretMatches(request.headers.get('x-cron-secret'))
}

async function handle(request: Request): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    // No detail in the body. "wrong secret" versus "no secret" is free
    // reconnaissance for whoever is probing.
    logger.warn({ path: '/api/cron/outbox' }, 'cron request rejected — bad or missing CRON_SECRET')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requested = Number(new URL(request.url).searchParams.get('batch'))
  const batchSize =
    Number.isInteger(requested) && requested > 0
      ? Math.min(requested, MAX_BATCH_SIZE)
      : DEFAULT_BATCH_SIZE

  const startedAt = Date.now()

  try {
    /**
     * No tenant scope on purpose. Route handlers run outside the ALS store, so
     * the Prisma tenant extension injects nothing and `drain()` sees every
     * organisation's queue — which is what a worker must do. Scoping it to a
     * tenant would silently strand every other organisation's mail.
     */
    const result = await notifications.drain({ batchSize })
    const durationMs = Date.now() - startedAt

    // Quiet when there is nothing to do, or an idle queue fills the log with a
    // line a minute and buries the runs that mattered.
    if (result.claimed > 0) {
      logger.info({ ...result, batchSize, durationMs }, 'outbox drained')
    }

    return NextResponse.json({ ok: true, ...result, durationMs })
  } catch (error) {
    // A drain failure must be visible to the platform as a 500 so the cron run is
    // recorded as failed, but individual send failures never reach here — those
    // are caught per row inside drain() and become FAILED/DEAD with backoff.
    logger.error({ err: error }, 'outbox drain failed')
    return NextResponse.json({ error: 'Drain failed' }, { status: 500 })
  }
}

/** Vercel Cron issues GET. */
export const GET = handle
/** POST for manual and external triggers. */
export const POST = handle
