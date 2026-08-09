import { Prisma } from '@prisma/client'

/**
 * Soft delete, applied by default.
 *
 * ── The MongoDB trap this exists to survive ─────────────────────────────────
 * Prisma's MongoDB connector translates `where: { deletedAt: null }` into
 * "field is PRESENT and null". It does NOT match documents where the field is
 * absent — even though raw MQL `{ deletedAt: null }` matches both.
 *
 *   document without a deletedAt key:
 *     Prisma  { deletedAt: null }            → 0 results   ← the trap
 *     Prisma  { deletedAt: { isSet: false }} → 1 result
 *     raw MQL { deletedAt: null }            → 1 result
 *
 * Because `deletedAt DateTime?` has no default, Prisma omits it on insert. So
 * without the invariant below, every row ever created is invisible to every
 * filtered read — silently, with no error. It presents as "the database is
 * empty" while the documents are plainly there.
 *
 * The fix is to make the field ALWAYS present: this extension injects
 * `deletedAt: null` on create. `prisma/migrations-data/0003-backfill-deleted-at.ts`
 * repairs documents written before the invariant existed, and `npm run doctor`
 * checks it so a regression is caught rather than discovered.
 *
 * ── LIMITATION: nested creates are not covered ──────────────────────────────
 * The hooks below rewrite the TOP-LEVEL `data` only. A nested relation create —
 *
 *   db.checklistTemplate.create({ data: { …, versions: { create: { … } } } })
 *
 * writes the child row untouched, so the child lands without a `deletedAt` key
 * and is invisible to every filtered read. Recursing would mean resolving each
 * relation key to its target model through the DMMF on every write, which is a
 * lot of machinery on a hot path for two call sites.
 *
 * So nested creates must pass `deletedAt: null` explicitly. Both current ones do
 * (`templates-service.ts`, `seed-deployment-template.ts`), and `npm run doctor`
 * is the backstop that catches a new one that forgets.
 *
 * Reads then use the plain `deletedAt: null` filter, which keeps queries simple
 * and lets the compound indexes work directly. The alternative — an `$or` with
 * `isSet: false` on every read — would defend against write paths that bypass
 * Prisma entirely, at the cost of permanent query complexity. Enforcing and
 * verifying the invariant is the better trade.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 * Forgetting the filter is the SAFE outcome; seeing deleted rows must be asked
 * for explicitly:
 *
 *   db.project.findMany({})                                    // live only
 *   db.project.findMany({ where: { deletedAt: { not: null } }}) // trash view
 */
const SOFT_DELETE_MODELS = new Set<string>([
  'Organization',
  'Environment',
  'User',
  'Role',
  'Membership',
  'Project',
  'ChecklistTemplate',
  'TemplateVersion',
  'ProjectTemplate',
  'DeploymentRun',
  'DeploymentComment',
  // Both carry `deletedAt` and an index on it, and their list queries filter
  // `deletedAt: null` — but omitting them here meant `create` never stamped the
  // field, so on MongoDB every key/integration was invisible the moment it was
  // saved (the null-vs-missing trap this file documents).
  'ApiKey',
  'Integration',
])

type AnyArgs = { where?: Record<string, unknown> } & Record<string, unknown>

function withNotDeleted(args: AnyArgs): AnyArgs {
  // `'deletedAt' in where` — not a truthiness check. An explicit
  // `deletedAt: null` from a caller is a deliberate choice, and
  // `deletedAt: { not: null }` from a trash view must not be overwritten.
  if (args.where && 'deletedAt' in args.where) return args
  return { ...args, where: { ...args.where, deletedAt: null } }
}

/**
 * Stamp `deletedAt: null` on insert so the field always exists.
 *
 * This is the invariant the read filter depends on — see the header.
 */
function withDeletedAtColumn(args: Record<string, unknown>): Record<string, unknown> {
  const data = args.data

  if (Array.isArray(data)) {
    return {
      ...args,
      data: data.map((row: Record<string, unknown>) =>
        'deletedAt' in row ? row : { ...row, deletedAt: null },
      ),
    }
  }

  if (data && typeof data === 'object') {
    const row = data as Record<string, unknown>
    if (!('deletedAt' in row)) return { ...args, data: { ...row, deletedAt: null } }
  }

  return args
}

export const softDeleteExtension = Prisma.defineExtension({
  name: 'soft-delete',
  query: {
    $allModels: {
      async findMany({ model, args, query }) {
        return SOFT_DELETE_MODELS.has(model) ? query(withNotDeleted(args)) : query(args)
      },
      async findFirst({ model, args, query }) {
        return SOFT_DELETE_MODELS.has(model) ? query(withNotDeleted(args)) : query(args)
      },
      async findFirstOrThrow({ model, args, query }) {
        return SOFT_DELETE_MODELS.has(model) ? query(withNotDeleted(args)) : query(args)
      },
      async count({ model, args, query }) {
        return SOFT_DELETE_MODELS.has(model) ? query(withNotDeleted(args)) : query(args)
      },
      async aggregate({ model, args, query }) {
        return SOFT_DELETE_MODELS.has(model) ? query(withNotDeleted(args)) : query(args)
      },

      // Establish the invariant on every insert path.
      async create({ model, args, query }) {
        return SOFT_DELETE_MODELS.has(model)
          ? query(withDeletedAtColumn(args as Record<string, unknown>) as typeof args)
          : query(args)
      },
      async createMany({ model, args, query }) {
        return SOFT_DELETE_MODELS.has(model)
          ? query(withDeletedAtColumn(args as Record<string, unknown>) as typeof args)
          : query(args)
      },
      async upsert({ model, args, query }) {
        if (!SOFT_DELETE_MODELS.has(model)) return query(args)
        const typed = args as unknown as Record<string, unknown>
        const create = typed.create as Record<string, unknown> | undefined
        if (create && !('deletedAt' in create)) {
          return query({ ...typed, create: { ...create, deletedAt: null } } as typeof args)
        }
        return query(args)
      },

      /**
       * findUnique is deliberately NOT filtered.
       *
       * Prisma restricts its `where` to unique fields, so `deletedAt` cannot be
       * appended — it is a type error. Services therefore resolve by
       * `findFirst({ where: { id, deletedAt: null } })` rather than findUnique
       * whenever the soft-delete guard matters.
       */
    },
  },
})

export { SOFT_DELETE_MODELS }
