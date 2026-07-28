import 'server-only'

import { PrismaClient } from '@prisma/client'
import type { ITXClientDenyList } from '@prisma/client/runtime/library'

import { env } from '@/lib/config/env'
import { logger } from '@/lib/logger'

import { auditImmutabilityExtension } from './audit-immutability-extension'
import { softDeleteExtension } from './soft-delete-extension'
import { tenantExtension } from './tenant-extension'

/**
 * The shared Prisma client.
 *
 * The singleton is not a style preference: Next.js hot-reload creates a new
 * module instance on every edit, and without the global cache the connection
 * pool is exhausted within a minute or two of active development.
 *
 * Extension order matters. They compose outside-in, so the last one applied
 * runs first:
 *   1. tenant          — injects organizationId (must run before filters)
 *   2. softDelete      — appends deletedAt: null
 *   3. auditImmutable  — refuses mutations of audit_logs
 */
function createClient() {
  const base = new PrismaClient({
    log:
      env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'error' }],
  })

  base.$on('warn', (e) => logger.warn({ prisma: e }, 'prisma warning'))
  base.$on('error', (e) => logger.error({ prisma: e }, 'prisma error'))

  return base
    .$extends(tenantExtension)
    .$extends(softDeleteExtension)
    .$extends(auditImmutabilityExtension)
}

export type ExtendedPrismaClient = ReturnType<typeof createClient>

/**
 * The client type handed to a `$transaction` callback.
 *
 * Must be derived from the EXTENDED client, not from `Prisma.TransactionClient`
 * — that alias describes the unextended client, and the two have incompatible
 * generic parameters. Services accept `Pick<TxClient, 'auditLog'>`-style
 * narrowings so they can be called with either the transaction client or the
 * root client, and so a service declares exactly which models it writes.
 */
export type TxClient = Omit<ExtendedPrismaClient, ITXClientDenyList>

const globalForPrisma = globalThis as unknown as {
  __prisma?: ExtendedPrismaClient
}

export const db: ExtendedPrismaClient = globalForPrisma.__prisma ?? createClient()

if (env.NODE_ENV !== 'production') globalForPrisma.__prisma = db

/**
 * Assert the deployment supports transactions.
 *
 * Called from instrumentation at boot in development. Every write path in this
 * system uses $transaction, so a standalone mongod fails at the first item
 * toggle with an error that does not obviously point at the cause. Failing here
 * with an actionable message saves an afternoon per developer.
 */
export async function assertTransactionSupport(): Promise<void> {
  try {
    await db.$transaction(async (tx) => {
      await tx.dataMigration.findFirst()
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/transaction|replica/i.test(message)) {
      throw new Error(
        '\n╭─ MongoDB is not a replica set ' + '─'.repeat(39) + '\n' +
          '  Prisma interactive transactions require a replica set, and every write\n' +
          '  path in this app depends on them.\n\n' +
          '  Fix one of these ways:\n' +
          '    • npm run dev:db          (no install, no Docker — recommended locally)\n' +
          '    • docker compose up -d    (if you have Docker)\n' +
          '    • MongoDB Atlas           (M0 free tier is already a replica set)\n\n' +
          '  Then set DATABASE_URL to include ?replicaSet=rs0&directConnection=true\n' +
          '╰' + '─'.repeat(70) + '\n\n' +
          `  Underlying error: ${message}\n`,
      )
    }
    throw error
  }
}
