import 'server-only'

import { db } from '@/lib/db/prisma'
import { logger } from '@/lib/logger'

/**
 * Fixed-window rate limiting, backed by MongoDB.
 *
 * In-process counters are NOT an option: every serverless instance would keep
 * its own counter, so the effective limit becomes N× whatever you configured.
 * A Mongo-backed counter is the zero-extra-infrastructure option that is
 * actually correct across instances. Swap in Redis (same interface) above
 * roughly 50 req/s.
 *
 * A TTL index on `expiresAt` handles cleanup — created by
 * prisma/migrations-data/0001-create-ttl-indexes.ts, since Prisma cannot express
 * TTL. Expiry is ALSO checked in code below, because MongoDB's TTL monitor runs
 * about once a minute and a stale row must not grant extra requests.
 */

export interface RateLimitRule {
  /** Bucket identity, e.g. `login:user@example.com`. */
  key: string
  limit: number
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: Date
  retryAfterSeconds: number
}

/** The named buckets used across the app — docs/06 §rate limiting. */
export const RATE_LIMITS = {
  login: (email: string) => ({ key: `login:${email.toLowerCase()}`, limit: 10, windowMs: 15 * 60_000 }),
  loginIp: (ip: string) => ({ key: `login:ip:${ip}`, limit: 30, windowMs: 15 * 60_000 }),
  forgotPassword: (email: string) => ({ key: `forgot:${email.toLowerCase()}`, limit: 5, windowMs: 60 * 60_000 }),
  forgotPasswordIp: (ip: string) => ({ key: `forgot:ip:${ip}`, limit: 20, windowMs: 60 * 60_000 }),
  acceptInvite: (ip: string) => ({ key: `accept:ip:${ip}`, limit: 20, windowMs: 60 * 60_000 }),
  invite: (actorId: string) => ({ key: `invite:${actorId}`, limit: 20, windowMs: 60 * 60_000 }),
  inviteResend: (invitationId: string) => ({ key: `resend:${invitationId}`, limit: 3, windowMs: 60 * 60_000 }),
  apiRead: (actorId: string) => ({ key: `api:read:${actorId}`, limit: 300, windowMs: 60_000 }),
  apiWrite: (actorId: string) => ({ key: `api:write:${actorId}`, limit: 60, windowMs: 60_000 }),
  export: (actorId: string) => ({ key: `export:${actorId}`, limit: 5, windowMs: 60 * 60_000 }),
  upload: (actorId: string) => ({ key: `upload:${actorId}`, limit: 30, windowMs: 60 * 60_000 }),
} as const

/**
 * Consume one unit from a bucket.
 *
 * Fails OPEN on a database error. A rate limiter that takes the site down when
 * Mongo hiccups is a worse outcome than briefly unlimited requests — but it is
 * logged at error level so it cannot pass unnoticed.
 */
export async function consume(rule: RateLimitRule, now = new Date()): Promise<RateLimitResult> {
  const windowEnd = new Date(now.getTime() + rule.windowMs)

  try {
    const existing = await db.rateLimit.findUnique({ where: { bucketKey: rule.key } })

    // No row, or the previous window has elapsed → start a fresh window.
    // The expiresAt check is what makes this correct despite TTL's ~60s lag.
    if (!existing || existing.expiresAt <= now) {
      await db.rateLimit.upsert({
        where: { bucketKey: rule.key },
        create: { bucketKey: rule.key, count: 1, windowStartedAt: now, expiresAt: windowEnd },
        update: { count: 1, windowStartedAt: now, expiresAt: windowEnd },
      })
      return {
        allowed: true,
        remaining: rule.limit - 1,
        limit: rule.limit,
        resetAt: windowEnd,
        retryAfterSeconds: 0,
      }
    }

    if (existing.count >= rule.limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000),
      )
      return {
        allowed: false,
        remaining: 0,
        limit: rule.limit,
        resetAt: existing.expiresAt,
        retryAfterSeconds,
      }
    }

    const updated = await db.rateLimit.update({
      where: { bucketKey: rule.key },
      data: { count: { increment: 1 } },
    })

    return {
      allowed: true,
      remaining: Math.max(0, rule.limit - updated.count),
      limit: rule.limit,
      resetAt: existing.expiresAt,
      retryAfterSeconds: 0,
    }
  } catch (error) {
    logger.error({ err: error, bucket: rule.key }, 'rate limiter unavailable — failing open')
    return {
      allowed: true,
      remaining: rule.limit,
      limit: rule.limit,
      resetAt: windowEnd,
      retryAfterSeconds: 0,
    }
  }
}

/** Read a bucket without consuming. For surfacing "N attempts remaining". */
export async function peek(rule: RateLimitRule, now = new Date()): Promise<RateLimitResult> {
  const row = await db.rateLimit.findUnique({ where: { bucketKey: rule.key } }).catch(() => null)
  const windowEnd = new Date(now.getTime() + rule.windowMs)

  if (!row || row.expiresAt <= now) {
    return { allowed: true, remaining: rule.limit, limit: rule.limit, resetAt: windowEnd, retryAfterSeconds: 0 }
  }

  const allowed = row.count < rule.limit
  return {
    allowed,
    remaining: Math.max(0, rule.limit - row.count),
    limit: rule.limit,
    resetAt: row.expiresAt,
    retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000)),
  }
}

/** Clear a bucket. Called on successful login so a good password resets the counter. */
export async function reset(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { bucketKey: key } }).catch(() => undefined)
}
