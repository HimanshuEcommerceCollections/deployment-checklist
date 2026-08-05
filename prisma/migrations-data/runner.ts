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

import { SEED_ROLES } from '../../src/lib/authz/permissions'

const db = new PrismaClient()

interface Migration {
  name: string
  up: (client: PrismaClient) => Promise<void>
  /**
   * Re-run on every invocation instead of once.
   *
   * `prisma db push` drops any index it cannot see in the schema, which includes
   * every TTL index here. A once-only ledger meant the first push after setup
   * silently removed them for good. Index creation is idempotent, so the repair
   * is simply to always re-apply it.
   */
  alwaysRun?: boolean
}

const MIGRATIONS: Migration[] = [
  {
    name: '0001-create-ttl-indexes',
    alwaysRun: true,
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
    alwaysRun: true,
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
        'project_templates', 'deployment_runs', 'deployment_comments',
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
  {
    name: '0004-drop-attachments',
    /**
     * Remove the attachments feature from existing databases.
     *
     * `prisma db push` only reconciles indexes on MongoDB — dropping a model from
     * the schema leaves its collection, its documents, and the now-orphaned
     * fields on other collections exactly where they were. Prisma simply stops
     * reading them, so the data lingers indefinitely and a future `db push`
     * never mentions it.
     *
     * The feature was interface-only: no provider was ever implemented, so
     * `attachmentIds` was never written and the collection is expected to be
     * empty. The count is logged rather than assumed, because a database that
     * somehow does hold rows should say so before they are dropped.
     */
    up: async (client) => {
      const counted = (await client.$runCommandRaw({
        count: 'attachments',
        query: {},
      })) as { n?: number }

      const docs = counted.n ?? 0
      if (docs > 0) {
        console.log(`      attachments: dropping collection holding ${docs} document(s)`)
      }

      // Dropping a non-existent collection is error 26 (NamespaceNotFound) —
      // expected on a fresh database, and the reason this is not fatal.
      try {
        await client.$runCommandRaw({ drop: 'attachments' })
        console.log('      attachments: collection dropped')
      } catch (error) {
        const code = (error as { code?: unknown }).code
        if (String(code) !== '26' && !/NamespaceNotFound/i.test(String(error))) throw error
      }

      const orphans: Array<[string, string]> = [
        ['checklist_item_states', 'attachmentIds'],
        ['deployment_runs', 'attachmentCount'],
        ['settings', 'storageProvider'],
        ['settings', 'storageBucket'],
        ['settings', 'storageRegion'],
        ['settings', 'storagePrefix'],
        ['settings', 'maxUploadMb'],
        ['settings', 'allowedMimeTypes'],
      ]

      for (const [collection, field] of orphans) {
        const result = (await client.$runCommandRaw({
          update: collection,
          updates: [
            {
              q: { [field]: { $exists: true } },
              u: { $unset: { [field]: '' } },
              multi: true,
            },
          ],
        })) as { nModified?: number }

        const modified = result.nModified ?? 0
        if (modified > 0) {
          console.log(`      ${collection}.${field}: unset on ${modified} document(s)`)
        }
      }
    },
  },
  {
    name: '0005-prune-attachment-permissions',
    /**
     * Remove the four `attachment.*` permissions from the database.
     *
     * `0004` dropped the attachment data but not the authorization vocabulary,
     * which lives in two places `db push` does not touch:
     *
     *   • `permission_definitions` — rendered from the code catalog on boot, but
     *     the seed upserts and never deletes, so removed keys linger as rows.
     *   • `roles.permissions` — the seeded roles were granted these keys, and
     *     `resolvePermissions()` now logs a "no longer in the catalog" warning on
     *     every request made by anyone holding them (see src/server/context.ts).
     *
     * The admin UI cannot fix this: the role editor renders checkboxes from the
     * code catalog, so a grant that is no longer in the catalog is invisible
     * there and can never be unticked. It has to be pruned here.
     *
     * Forward-only, per the rules above: `0004` already ran, so this corrects it
     * in a new migration rather than being folded back into it.
     */
    up: async (client) => {
      const removed = [
        'attachment.read',
        'attachment.upload',
        'attachment.delete_own',
        'attachment.delete_any',
      ]

      const definitions = (await client.$runCommandRaw({
        delete: 'permission_definitions',
        deletes: [{ q: { key: { $in: removed } }, limit: 0 }],
      })) as { n?: number }

      const deleted = definitions.n ?? 0
      if (deleted > 0) console.log(`      permission_definitions: deleted ${deleted} row(s)`)

      // $pullAll rather than $pull so the grant list keeps its order, and because
      // it is a no-op on roles that never held these keys.
      const roles = (await client.$runCommandRaw({
        update: 'roles',
        updates: [
          {
            q: { permissions: { $in: removed } },
            u: { $pullAll: { permissions: removed } },
            multi: true,
          },
        ],
      })) as { nModified?: number }

      const pruned = roles.nModified ?? 0
      if (pruned > 0) console.log(`      roles.permissions: pruned on ${pruned} role(s)`)
    },
  },
  {
    name: '0006-consolidate-seed-roles',
    /**
     * Move each organisation onto the consolidated role set (docs/14 §14.3).
     *
     * `developer` and `devops` are retired: `developer` became `engineer` (same
     * job, plus `deployment.complete`) and `devops` folded into `release-manager`.
     *
     * Two things the seed cannot do, which is why this exists:
     *
     *   1. The seed's update branch only re-syncs permissions for `isSystem`
     *      roles — everything else is left alone so an admin's edits survive
     *      re-seeding. Correct as a rule, but it means `release-manager` would
     *      keep its old permission list for ever.
     *   2. The seed only ever upserts. It has no notion of a role that should no
     *      longer exist.
     *
     * A retired role is soft-deleted ONLY when nobody holds it. Stripping a role
     * out from under a live user would silently revoke their access, and no
     * automatic remap is safe: every candidate successor grants strictly more or
     * strictly less than what they had. So a held role survives and is reported
     * for an admin to reassign deliberately.
     */
    up: async (client) => {
      const RETIRED: Record<string, string> = {
        developer: 'engineer',
        devops: 'release-manager',
      }

      const organizations = await client.organization.findMany({ select: { id: true } })

      for (const org of organizations) {
        // Bring the current set into line with the code catalog. Safe to force:
        // these are the definitions the code ships, and a role an admin renamed
        // or re-scoped keeps its identity — only permissions are authoritative here.
        for (const role of SEED_ROLES) {
          await client.role.upsert({
            where: { organizationId_key: { organizationId: org.id, key: role.key } },
            create: {
              organizationId: org.id,
              key: role.key,
              name: role.name,
              description: role.description,
              color: role.color,
              permissions: [...role.permissions],
              isSystem: 'isSystem' in role ? role.isSystem : false,
              isSuperAdmin: 'isSuperAdmin' in role ? role.isSuperAdmin : false,
              isDefault: 'isDefault' in role ? role.isDefault : false,
              deletedAt: null,
            },
            update: {
              name: role.name,
              description: role.description,
              permissions: [...role.permissions],
              isDefault: 'isDefault' in role ? role.isDefault : false,
              deletedAt: null,
            },
          })
        }

        for (const [retiredKey, successorKey] of Object.entries(RETIRED)) {
          const retired = await client.role.findFirst({
            where: { organizationId: org.id, key: retiredKey, deletedAt: null },
            select: { id: true, key: true },
          })
          if (!retired) continue

          const holders = await client.user.findMany({
            where: { organizationId: org.id, roleIds: { has: retired.id }, deletedAt: null },
            select: { email: true },
          })
          const memberships = await client.membership.count({
            where: { roleId: retired.id, deletedAt: null },
          })

          if (holders.length > 0 || memberships > 0) {
            const who = holders.map((h) => h.email).join(', ') || `${memberships} membership(s)`
            console.log(
              `      kept "${retired.key}" — still assigned to ${who}. ` +
                `Reassign to "${successorKey}" in the admin UI, then re-run.`,
            )
            continue
          }

          await client.role.update({
            where: { id: retired.id },
            data: { deletedAt: new Date() },
          })
          console.log(`      retired "${retired.key}" → superseded by "${successorKey}"`)
        }
      }
    },
  },
  {
    name: '0007-retire-superseded-roles',
    alwaysRun: true,
    /**
     * Finish what `0006` could not.
     *
     * `0006` leaves a retired role alive when somebody still holds it, because no
     * automatic remap is safe. That leaves a manual step — reassign the holder —
     * and once it is done, something has to come back and retire the role.
     *
     * A once-only migration cannot: the runner skips anything already recorded,
     * so `0006` never runs again and the leftover role would linger until someone
     * wrote `0008`. Hence `alwaysRun`: the sweep is idempotent (it only ever
     * soft-deletes an unheld, not-yet-deleted role) and cheap, so it can simply
     * re-check on every deploy and complete itself whenever the holders are gone.
     *
     * Deliberately narrower than `0006`: retirement only. It never touches
     * permissions, so a repeatable migration can never overwrite an admin's edits.
     */
    up: async (client) => {
      const SUPERSEDED: Record<string, string> = {
        developer: 'engineer',
        devops: 'release-manager',
      }

      for (const [retiredKey, successorKey] of Object.entries(SUPERSEDED)) {
        const roles = await client.role.findMany({
          where: { key: retiredKey, deletedAt: null },
          select: { id: true, key: true, organizationId: true },
        })

        for (const role of roles) {
          const holders = await client.user.count({
            where: { roleIds: { has: role.id }, deletedAt: null },
          })
          const memberships = await client.membership.count({
            where: { roleId: role.id, deletedAt: null },
          })

          if (holders > 0 || memberships > 0) continue

          await client.role.update({ where: { id: role.id }, data: { deletedAt: new Date() } })
          console.log(`      retired "${role.key}" → superseded by "${successorKey}"`)
        }
      }
    },
  },
  {
    name: '0008-relax-password-policy',
    /**
     * Bring existing organizations onto the relaxed policy: minimum length 8, no
     * composition requirement.
     *
     * Changing the Prisma defaults is not enough on its own. `@default` applies
     * when a row is created, and every Setting row already written carries the old
     * 12 / true — while the services read `settings?.passwordMinLength ??
     * DEFAULT_POLICY.minLength`, so the stored value wins and the new default is
     * never consulted. Without this the relaxation would appear to ship and change
     * nothing for anyone already using the system.
     *
     * Deliberately NOT alwaysRun. It is a one-time relaxation, not a standing
     * override: an administrator who later decides on 14 characters must not have
     * it quietly undone on the next deploy. Same reasoning as the note on `0007`
     * about never overwriting an admin's edits.
     *
     * Scoped to rows still holding the old defaults exactly. Anything already
     * customised is somebody's decision and is left alone.
     */
    up: async (client) => {
      const { count } = await client.setting.updateMany({
        where: { passwordMinLength: 12, passwordRequireMixed: true },
        data: { passwordMinLength: 8, passwordRequireMixed: false },
      })

      console.log(
        count > 0
          ? `      relaxed the password policy for ${count} organization${count === 1 ? '' : 's'} (min 8, no composition rule)`
          : '      no organization was still on the old 12/mixed defaults',
      )
    },
  },
  {
    name: '0009-lift-membership-roles-to-user',
    /**
     * Move to roles on the user, with membership as pure project assignment.
     *
     * Before this, a Membership carried the role a person held on that project, so
     * the same user could be Engineer on one and Viewer on another. That capability
     * is being removed in favour of one role set per user, applied to whichever
     * projects they are assigned to.
     *
     * The lift preserves effective access rather than resetting it: every role a
     * user held through any membership is unioned into `User.roleIds`. Someone who
     * was Engineer on two projects becomes an Engineer assigned to two projects,
     * which resolves to the same permissions in the same places.
     *
     * It cannot be `alwaysRun`. Running twice is harmless for the union — it is
     * idempotent — but a user whose roles an administrator later trimmed would have
     * them silently restored from membership rows that still remember the old ones.
     */
    up: async (client) => {
      const memberships = await client.membership.findMany({
        where: { deletedAt: null, roleId: { not: null } },
        select: { id: true, userId: true, projectId: true, roleId: true },
        orderBy: { createdAt: 'asc' },
      })

      if (memberships.length === 0) {
        console.log('      no project-scoped role grants to lift')
        return
      }

      const rolesByUser = new Map<string, Set<string>>()
      for (const row of memberships) {
        if (!row.roleId) continue
        const set = rolesByUser.get(row.userId) ?? new Set<string>()
        set.add(row.roleId)
        rolesByUser.set(row.userId, set)
      }

      for (const [userId, roleIds] of rolesByUser) {
        const user = await client.user.findUnique({
          where: { id: userId },
          select: { email: true, roleIds: true },
        })
        if (!user) continue

        const merged = [...new Set([...user.roleIds, ...roleIds])]
        if (merged.length === user.roleIds.length) continue

        await client.user.update({ where: { id: userId }, data: { roleIds: merged } })
        console.log(
          `      ${user.email}: lifted ${merged.length - user.roleIds.length} role(s) from memberships`,
        )
      }

      /**
       * Collapse to one row per (user, project). The old unique key included
       * roleId, so two roles on one project meant two rows — and the new key would
       * reject them.
       */
      const seen = new Set<string>()
      let collapsed = 0
      for (const row of memberships) {
        const pair = `${row.userId}:${row.projectId}`
        if (seen.has(pair)) {
          await client.membership.delete({ where: { id: row.id } })
          collapsed += 1
          continue
        }
        seen.add(pair)
        await client.membership.update({ where: { id: row.id }, data: { roleId: null } })
      }

      console.log(
        `      ${seen.size} assignment(s) kept, roleId cleared` +
          (collapsed > 0 ? `, ${collapsed} duplicate row(s) removed` : ''),
      )
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
    if (applied.has(migration.name) && !migration.alwaysRun) {
      console.log(`  ✓ ${migration.name} (already applied)`)
      continue
    }

    console.log(`  → ${migration.name}${migration.alwaysRun ? ' (repeatable)' : ''}`)
    const startedAt = Date.now()

    await migration.up(db)

    const record = {
      // Guards against an already-applied migration being edited later.
      checksum: createHash('sha256').update(migration.up.toString()).digest('hex').slice(0, 16),
      durationMs: Date.now() - startedAt,
      appliedBy: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.USER ?? 'local',
    }

    await db.dataMigration.upsert({
      where: { name: migration.name },
      create: { name: migration.name, ...record },
      update: record,
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
