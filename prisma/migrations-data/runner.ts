/**
 * Data-migration runner.
 *
 * `prisma migrate` does not support MongoDB — only `prisma db push`, which
 * applies the schema and creates indexes but cannot express TTL indexes, Atlas
 * Search indexes, or any data backfill. Without a runner those become one-off
 * scripts someone executes by hand from a laptop, twice, in the wrong order.
 *
 *   npm run db:migrate-data
 *
 * Rules for every migration:
 *   • idempotent — it WILL be re-run when a deploy is retried
 *   • forward-only — no `down`; correcting a bad migration means writing another
 *   • ordered — the array below is the order of application
 */
import '../../scripts/load-env'

import { createHash } from 'node:crypto'

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

interface Migration {
  name: string
  up: (client: PrismaClient) => Promise<void>
}

const MIGRATIONS: Migration[] = [
  {
    name: '0001-create-ttl-indexes',
    /**
     * TTL indexes cannot be declared in the Prisma schema.
     *
     * Note: MongoDB's TTL monitor runs roughly once a minute, so an expired
     * document can survive briefly. Expiry is therefore ALSO checked in
     * application code — TTL here is storage hygiene, not a security control.
     */
    up: async (client) => {
      const ttlIndexes: Array<[string, string]> = [
        ['auth_tokens', 'expiresAt'],
        ['rate_limits', 'expiresAt'],
        ['job_locks', 'expiresAt'],
      ]

      for (const [collection, field] of ttlIndexes) {
        await createTtlIndex(client, collection, field, 0)
      }
    },
  },
  {
    name: '0002-notification-outbox-prune-index',
    /**
     * Sent notifications are pruned after 30 days — they are an operational
     * record, and the audit log is the durable one. Applied as a TTL on sentAt
     * with a partial filter so PENDING and DEAD rows are never touched.
     */
    up: async (client) => {
      await createTtlIndex(client, 'notification_outbox', 'sentAt', 60 * 60 * 24 * 30, {
        status: 'SENT',
      })
    },
  },
  {
    name: '0003-backfill-deleted-at',
    /**
     * Ensure every soft-deletable document HAS a `deletedAt` field.
     *
     * Prisma's MongoDB connector reads `where: { deletedAt: null }` as "present
     * and null" — it does not match documents where the field is absent, unlike
     * raw MQL. Since `deletedAt DateTime?` has no default, Prisma omits it on
     * insert, so any document written before the soft-delete extension started
     * stamping it is invisible to every filtered read. Silently: no error, just
     * empty results.
     *
     * `src/lib/db/soft-delete-extension.ts` now maintains the invariant on
     * write. This repairs history.
     */
    up: async (client) => {
      const collections = [
        'organizations', 'environments', 'users', 'roles', 'memberships',
        'projects', 'checklist_templates', 'template_versions',
        'project_templates', 'deployment_runs', 'deployment_comments', 'attachments',
      ]

      for (const collection of collections) {
        const result = (await client.$runCommandRaw({
          update: collection,
          updates: [
            {
              q: { deletedAt: { $exists: false } },
              u: { $set: { deletedAt: null } },
              multi: true,
            },
          ],
        })) as { nModified?: number; n?: number }

        const modified = result.nModified ?? 0
        if (modified > 0) console.log(`      ${collection}: stamped ${modified} document(s)`)
      }
    },
  },
]

/**
 * Create a TTL index, healing an existing plain index on the same key.
 *
 * MongoDB rejects a plain and a TTL index on the same single field with error 85
 * (IndexOptionsConflict). That happens whenever the Prisma schema also declares
 * `@@index([expiresAt])` — which it no longer does, but existing databases
 * created before that fix still carry the plain index. Dropping and recreating
 * is safe: an index carries no data.
 *
 * Idempotent, because this runs again on every retried deploy.
 */
async function createTtlIndex(
  client: PrismaClient,
  collection: string,
  field: string,
  expireAfterSeconds: number,
  partialFilterExpression?: Record<string, unknown>,
): Promise<void> {
  const name = `${collection}_${field}_ttl`

  const spec: Record<string, unknown> = {
    key: { [field]: 1 },
    name,
    expireAfterSeconds,
    ...(partialFilterExpression ? { partialFilterExpression } : {}),
  }

  const create = () =>
    client.$runCommandRaw({ createIndexes: collection, indexes: [spec] as never })

  try {
    await create()
    console.log(`      TTL index ${name} (${expireAfterSeconds}s)`)
    return
  } catch (error) {
    const message = errorText(error)

    // Already exactly right → nothing to do.
    if (/IndexAlreadyExists|already exists with the same name/i.test(message)) {
      console.log(`      TTL index ${name} already present`)
      return
    }

    // A different index occupies this key. Find it, drop it, retry.
    if (!/IndexOptionsConflict|IndexKeySpecsConflict|code 85|code 86/i.test(message)) {
      throw error
    }

    const conflicting = await findIndexNameForKey(client, collection, field, name)
    if (!conflicting) throw error

    console.log(`      dropping conflicting index ${conflicting} on ${collection}.${field}`)
    await client.$runCommandRaw({ dropIndexes: collection, index: conflicting })

    await create()
    console.log(`      TTL index ${name} (${expireAfterSeconds}s)`)
  }
}

async function findIndexNameForKey(
  client: PrismaClient,
  collection: string,
  field: string,
  excludeName: string,
): Promise<string | null> {
  const result = (await client.$runCommandRaw({
    listIndexes: collection,
  })) as { cursor?: { firstBatch?: Array<{ name: string; key: Record<string, number> }> } }

  const indexes = result.cursor?.firstBatch ?? []

  for (const index of indexes) {
    const keys = Object.keys(index.key ?? {})
    // Single-field index on exactly this key, and not the one we want to create.
    if (keys.length === 1 && keys[0] === field && index.name !== excludeName) {
      return index.name
    }
  }

  return null
}

function errorText(error: unknown): string {
  if (error && typeof error === 'object') {
    const meta = (error as { meta?: { message?: string } }).meta
    if (meta?.message) return meta.message
    if (error instanceof Error) return error.message
  }
  return String(error)
}

async function run() {
  console.log('\nApplying data migrations…\n')

  const applied = new Set(
    (await db.dataMigration.findMany({ select: { name: true } })).map((row) => row.name),
  )

  let count = 0

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) {
      console.log(`  ✓ ${migration.name} (already applied)`)
      continue
    }

    console.log(`  → ${migration.name}`)
    const startedAt = Date.now()

    await migration.up(db)

    await db.dataMigration.create({
      data: {
        name: migration.name,
        // Guards against an already-applied migration being edited later.
        checksum: createHash('sha256').update(migration.up.toString()).digest('hex').slice(0, 16),
        durationMs: Date.now() - startedAt,
        appliedBy: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.USER ?? 'local',
      },
    })

    count += 1
    console.log(`    applied in ${Date.now() - startedAt}ms`)
  }

  console.log(`\n${count === 0 ? 'Nothing to apply' : `Applied ${count} migration(s)`}.\n`)
}

run()
  .catch((error) => {
    console.error('\nData migration failed:\n')
    console.error(error)
    process.exit(1)
  })
  .finally(() => void db.$disconnect())
