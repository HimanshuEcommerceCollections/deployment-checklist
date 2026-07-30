# 3 — Data Model

Covers deliverables **3** (database schema), **5** (ERD), and **15** (MongoDB collection design). The executable artifact is [prisma/schema.prisma](../prisma/schema.prisma); this document explains *why* it looks like that.

---

## 3.1 Entity relationship diagram

```mermaid
erDiagram
    Organization  ||--o| Setting                : "configures"
    Organization  ||--o{ User                   : "employs"
    Organization  ||--o{ Role                   : "defines"
    Organization  ||--o{ Project                : "owns"
    Organization  ||--o{ Environment            : "defines"
    Organization  ||--o{ ChecklistTemplate      : "owns"
    Organization  ||--o{ DeploymentRun          : "scopes"
    Organization  ||--o{ AuditLog               : "scopes"
    Organization  ||--o{ NotificationOutbox     : "scopes"
    Organization  ||--o{ Invitation             : "issues"

    User          ||--o{ Membership             : "granted via"
    Project       ||--o{ Membership             : "grants on"
    Role          ||--o{ Membership             : "conferred by"
    User          }o--o{ Role                   : "global roleIds[]"

    User          ||--o{ Invitation             : "invitedBy"
    User          ||--o{ AuthToken              : "resets with"
    User          ||--o{ DeploymentComment      : "authors"

    Project       ||--o{ ProjectTemplate        : "enables"
    ChecklistTemplate ||--o{ ProjectTemplate    : "enabled on"
    ChecklistTemplate ||--o{ TemplateVersion    : "revised as"

    TemplateVersion ||--|{ TemplateSection      : "EMBEDS"
    TemplateSection ||--|{ TemplateItem         : "EMBEDS"

    Project       ||--o{ DeploymentRun          : "target of"
    Environment   ||--o{ DeploymentRun          : "deployed to"
    TemplateVersion ..o{ DeploymentRun          : "lineage only (no reads)"

    DeploymentRun ||--|| ChecklistSnapshot      : "EMBEDS (immutable)"
    ChecklistSnapshot ||--|{ SnapshotSection    : "EMBEDS"
    SnapshotSection ||--|{ SnapshotItem         : "EMBEDS"

    DeploymentRun ||--o{ ChecklistItemState     : "mutable state, 1 per item"
    DeploymentRun ||--o{ DeploymentComment      : "discussed in"
    DeploymentRun ||--o| DeploymentRun          : "rollbackOfId"
    DeploymentComment ||--o| DeploymentComment  : "parentId (1 level)"

    PermissionDefinition }o--o{ Role            : "referenced by key"
```

The two relationships that carry the whole design:

- `TemplateVersion ..o{ DeploymentRun` is **dotted**: a run stores `templateVersionId` for lineage and reporting, but no code path ever dereferences it to render a checklist. That is what makes template edits safe.
- `DeploymentRun ||--o{ ChecklistItemState` is the deliberate split of immutable definition from mutable state.

### Logical view

```
Organization
 ├── Setting (1:1)
 ├── Environment*          development · qa · uat · staging · production  (configurable)
 ├── Role*                 Admin · Developer · QA · DevOps · Release Manager
 │     └── permissions[]   ── keys from PermissionDefinition (seeded from code)
 ├── User*
 │     ├── roleIds[]       ── global grants
 │     └── Membership*     ── (project, role) grants
 ├── Project*              Apex · Elevate · Internal Portal · Website
 │     └── ProjectTemplate*  ── M:N link, carries isDefault + environmentKeys
 ├── ChecklistTemplate*
 │     └── TemplateVersion*   v1 PUBLISHED · v2 PUBLISHED · v3 DRAFT
 │           └── [TemplateSection]        embedded
 │                 └── [TemplateItem]     embedded
 └── DeploymentRun*        APEX-142
       ├── {ChecklistSnapshot}            embedded, frozen at creation
       │     └── [SnapshotSection → SnapshotItem]
       ├── ChecklistItemState*            one small doc per item — mutable
       └── DeploymentComment*             markdown
```

---

## 3.2 The snapshot pattern

The requirement: *"If Admin edits the template tomorrow, old deployments must remain unchanged. Each deployment stores its own immutable checklist."*

### Options considered

| Option | Immutable? | Concurrent toggles | Read cost | Verdict |
|---|---|---|---|---|
| **A** Reference live `TemplateVersion` | ✗ | fine | 1 join | Fails the requirement outright |
| **B** Copy items into a `DeploymentChecklistItem` collection | ✓ | ✓ | 1 query + sort | Viable; loses "the checklist is one thing" and needs 200 docs with duplicated label text |
| **C** Embed everything, including `checked` | ✓ | **✗ lost updates** | 0 extra | Fails under two concurrent users |
| **D** Embed the definition; separate collection for state | ✓ | ✓ | 2 queries | **Chosen** |

### Why C fails, concretely

Prisma's MongoDB connector cannot update one element of a composite list by predicate. To flip `sections[2].items[4].checked` it must `set` the entire `sections` array. So:

```
t0  Alice reads run  (sections array, 120 items)
t1  Bob   reads run  (same array)
t2  Alice ticks "QA Approved"  → writes whole array  ✓
t3  Bob   ticks "Backup Done"  → writes whole array (stale) → Alice's tick is GONE
```

No error, no warning. During a release window, with several engineers on the same console, this is not a theoretical race — it is the normal case. Any fix (read-modify-write with a version guard on the parent document) serialises *all* toggles on one document and makes every tick a full-array rewrite.

### Why D works

```
DeploymentRun                          ChecklistItemState  (one doc per item)
┌──────────────────────────────────┐   ┌───────────────────────────────────┐
│ checklist: {                     │   │ deploymentId  ─┐ unique together  │
│   templateVersionId, version: 2, │   │ itemId        ─┘                  │
│   capturedAt,                    │   │ checked, checkedById, checkedAt   │
│   sections: [                    │   │ note                              │
│     { id, title, order,          │   │ skipped, skipReason               │
│       items: [                   │   │ revision   ← optimistic guard     │
│         { id, label, isRequired, │   └───────────────────────────────────┘
│           evidenceRequired,      │
│           sourceItemId } … ] } ]  │   counters on the run, kept by $inc:
│ }                                │   totalItems · totalRequired
│  ── WRITTEN ONCE. NEVER UPDATED. │   completedItems · completedRequired
└──────────────────────────────────┘
```

- **Immutability is structural.** The `checklist` field is written by `snapshot-builder.ts` at creation and by nothing else. No `update` in the codebase names it. It cannot drift.
- **Toggles are atomic and conflict-detecting** — a conditional `updateMany` on `(deploymentId, itemId, revision)`; `count: 0` means someone beat you, and the client reconciles.
- **Progress never aggregates.** Denormalised counters on the run are `$inc`-ed in the same transaction, so the history grid renders `completedItems / totalItems` from the document it already fetched.
- **Per-item audit falls out naturally** — every toggle is one small document write with a clear before/after.

### Building a snapshot

```ts
// src/features/deployments/server/snapshot-builder.ts
export function buildSnapshot(
  version: TemplateVersionWithSections,
  environmentKey: string,
  ids: IdGenerator,
  now: Date,
): { snapshot: ChecklistSnapshot; states: ChecklistItemStateSeed[] } {
  const sections: SnapshotSection[] = []
  const states: ChecklistItemStateSeed[] = []

  for (const section of sortByOrder(version.sections.filter(alive))) {
    // Environment-specific checklists: an item with environmentKeys declared is
    // only captured for those environments. Empty array = every environment.
    const items = sortByOrder(section.items.filter(alive))
      .filter((i) => i.environmentKeys.length === 0 || i.environmentKeys.includes(environmentKey))

    if (items.length === 0) continue          // drop sections that end up empty

    const sectionId = ids.next()
    sections.push({
      id: sectionId,
      sourceSectionId: section.id,
      title: section.title,
      description: section.description,
      order: sections.length,
      items: items.map((item, index) => ({
        id: ids.next(),
        sourceItemId: item.id,                // lineage for analytics — never for reads
        label: item.label,
        helpText: item.helpText,
        order: index,
        isRequired: item.isRequired,
        evidenceRequired: item.evidenceRequired,
        ownerRoleKey: item.ownerRoleKey,
        metadata: item.metadata,
      })),
    })
  }

  for (const s of sections)
    for (const i of s.items)
      states.push({ sectionId: s.id, itemId: i.id, order: i.order, isRequired: i.isRequired })

  return {
    snapshot: {
      templateId: version.templateId,
      templateVersionId: version.id,
      templateKey: version.template.key,
      templateName: version.template.name,
      version: version.version,
      completionPolicy: version.completionPolicy,
      capturedAt: now,
      sections,
    },
    states,
  }
}
```

Snapshot item ids are **freshly generated**, not copied from the template. Two runs from the same version get different `SnapshotItem.id` values, so `ChecklistItemState.itemId` is globally unambiguous while `sourceItemId` still answers "how often does *Sonar Passed* block us?" across all runs.

### Document size

A 10-section, 120-item checklist with help text is roughly 60–100 KB — well inside MongoDB's 16 MB document limit, with two orders of magnitude of headroom. A checklist large enough to threaten the limit (~20,000 items) would be a product problem long before a storage one. Guard rails: `template.maxItems` soft-validated at 500 in the Zod schema.

---

## 3.3 Embed or reference: the decision applied

The rule used throughout: **embed when the child has no independent lifecycle, is always read with its parent, is bounded, and is not written concurrently by different actors.**

| Data | Decision | Reasoning |
|---|---|---|
| `TemplateSection` / `TemplateItem` | **Embed** in `TemplateVersion` | Never queried alone. Always loaded with the version. Bounded (tens). Reorder becomes one atomic array write instead of N updates. Edited by one admin at a time in a form. |
| `ChecklistSnapshot` | **Embed** in `DeploymentRun` | The immutability requirement. One document read renders the whole console. |
| `ChecklistItemState` | **Reference** | Concurrent per-item writes. Prisma cannot do positional composite updates. |
| `DeploymentComment` | **Reference** | Unbounded growth, independent pagination, own soft delete, own audit. |
| `AuditLog` | **Reference** | Highest-volume collection. Must never inflate a hot document. |
| `Setting` | Separate 1:1 collection | Read on nearly every request and cached; keeping it out of `Organization` keeps that cache tight and secrets in one place. |
| `Membership` | Join collection | Needs `(user, project, role)` uniqueness and its own audit. |
| `ProjectTemplate` | Join collection | Carries `isDefault`, `environmentKeys`, `order`. Prisma has no implicit M:N on MongoDB anyway. |
| `Role.permissions` | **Embed** (`String[]`) | Read on every request as one unit; small; changed as a set. |

### Soft delete inside embedded documents

`TemplateSection` and `TemplateItem` both carry `deletedAt`. Deleting an item sets the timestamp inside the array; restoring clears it. Queries filter with `alive()` in the domain layer rather than at the database level, because the whole array is loaded anyway. Soft-deleted items are excluded from snapshots but remain visible in the admin trash view and in older snapshots that already captured them — exactly the desired behaviour.

---

## 3.4 Collection design

18 collections. Sizes are order-of-magnitude estimates for a 200-engineer org after three years.

| Collection | Docs (3yr) | Growth | Access pattern | Notes |
|---|---|---|---|---|
| `organizations` | 1 | none | cached | Multi-tenancy seam |
| `settings` | 1 | none | every request, cached 60 s | Encrypted secret refs |
| `environments` | ~5 | none | cached | Configurable, not an enum |
| `users` | ~300 | slow | by id, by email, list | `email` unique |
| `roles` | ~8 | slow | cached | `permissions[]` embedded |
| `permission_definitions` | ~50 | on deploy | admin UI only | Seeded from code |
| `memberships` | ~2,000 | slow | by user, by project | Drives project-scoped authz |
| `invitations` | ~500 | slow | by tokenHash, by email | Hashed tokens |
| `auth_tokens` | ~2,000 | churns | by tokenHash | **TTL index** |
| `projects` | ~30 | slow | list, by slug | Denormalised counters |
| `checklist_templates` | ~20 | slow | list, by key | `currentVersionId` pointer |
| `template_versions` | ~150 | slow | by template, by id | Embeds sections/items |
| `project_templates` | ~80 | slow | by project | M:N with metadata |
| `deployment_runs` | ~20,000 | steady | **hot list + hot detail** | Embeds snapshot; heaviest read |
| `checklist_item_states` | **~2,400,000** | steady | by deployment | ~120/run; small docs |
| `deployment_comments` | ~60,000 | steady | by deployment | Markdown |
| `audit_logs` | **~8,000,000** | fastest | by entity, actor, project, time | Append-only; archive path |
| `notification_outbox` | ~200,000 | churns | by status + nextAttemptAt | Prune SENT after 30 d |
| `deployment_daily_stats` | ~55,000 | steady | dashboard reads | Pre-aggregated |
| `rate_limits`, `job_locks`, `data_migrations` | small | churns | infra | **TTL indexes** on first two |

Two collections dominate and both are designed for it. `checklist_item_states` documents are ~200 bytes and always queried by `deploymentId` — an index-covered range scan of 120 docs. `audit_logs` is append-only, never updated, has an archive path, and is the natural first candidate for a MongoDB time-series collection if volume outgrows the current shape.

### Sharding readiness

Not needed at this scale, but the shard keys are already the natural ones if it ever is: `deployment_runs` → `{ organizationId: 1, projectId: 1 }`; `checklist_item_states` → `{ deploymentId: 1 }` (co-locates all of a run's state on one shard); `audit_logs` → `{ organizationId: 1, createdAt: 1 }`.

---

## 3.5 Indexes

Every compound index follows **ESR** — Equality fields first, then Sort, then Range. The full list with the query each one serves lives in [prisma/indexes.md](../prisma/indexes.md); the load-bearing ones:

```
deployment_runs
  (organizationId, status, createdAt↓)                  history filtered by status
  (organizationId, projectId, status, createdAt↓)        project history
  (organizationId, environmentKey, createdAt↓)           "production deploys this month"
  (organizationId, completedAt↓)                         completion-rate windows
  (organizationId, deletedAt, createdAt↓)                default list (excludes deleted)
  (projectId, sequence)  UNIQUE                          reference generation, APEX-142
  (projectId, version)                                   "has 2.14.0 shipped to prod?"
  (startedById, createdAt↓)                              "my deployments"
  (organizationId, searchText)                           regex search fallback

checklist_item_states
  (deploymentId, itemId)  UNIQUE                         the toggle guard — critical
  (deploymentId, sectionId, order)                       console render, pre-sorted
  (deploymentId, checked)                                outstanding-item queries
  (organizationId, itemId, checked)                      analytics: most-blocking items

audit_logs
  (organizationId, createdAt↓)                           global activity feed
  (organizationId, entityType, entityId, createdAt↓)     "history of this deployment"
  (organizationId, actorId, createdAt↓)                  "what did this user do"
  (organizationId, projectId, createdAt↓)                project activity
  (organizationId, action, createdAt↓)                   filter by action type
  (deploymentId, createdAt)                              deployment timeline
  (correlationId)                                        everything from one request

users            email UNIQUE · (organizationId, status, name) · (organizationId, deletedAt)
memberships      (userId, projectId, roleId) UNIQUE · (projectId, deletedAt) · (userId, deletedAt)
invitations      tokenHash UNIQUE · (organizationId, status, createdAt↓) · (expiresAt)
auth_tokens      tokenHash UNIQUE · (expiresAt) → TTL
template_versions (templateId, version) UNIQUE · (templateId, status, version↓)
notification_outbox idempotencyKey UNIQUE · (status, nextAttemptAt)
deployment_daily_stats (organizationId, day, projectId, environmentKey) UNIQUE
```

### TTL indexes

Prisma cannot express TTL, so `prisma/migrations-data/0001-create-ttl-indexes.ts` creates them:

```ts
await db.$runCommandRaw({
  createIndexes: 'auth_tokens',
  indexes: [{ key: { expiresAt: 1 }, name: 'auth_tokens_ttl', expireAfterSeconds: 0 }],
})
// same for rate_limits.expiresAt and job_locks.expiresAt
```

Note the trade-off deliberately taken: MongoDB's TTL monitor runs about once a minute, so an expired token can survive for up to ~60 seconds. Expiry is therefore **also** checked in application code — TTL is storage hygiene, not a security control.

### Unique index on soft-deleted rows

A soft-deleted project keeps its `key`, so `(organizationId, key)` unique blocks reuse of the name. Deliberate: silently allowing two projects called `Apex` (one deleted) makes audit history ambiguous. The admin trash view offers *restore* or *permanently delete*; only the latter frees the key. `users.email` behaves the same way — reactivate rather than re-invite.

---

## 3.6 Denormalisation register

Every denormalised field is a deliberate trade, so each needs an owner that keeps it true. Anything not on this list should not be duplicated.

| Field | Source of truth | Kept in step by | Why |
|---|---|---|---|
| `DeploymentRun.completedItems` / `completedRequired` | `ChecklistItemState` | same transaction as the toggle | history grid renders progress without aggregating |
| `DeploymentRun.totalItems` / `totalRequired` | the snapshot | written once at creation | immutable, so it cannot drift |
| `DeploymentRun.environmentKey` / `environmentName` | `Environment` | written once at creation | history stays readable after a rename or delete |
| `DeploymentRun.startedByName` / `completedByName` | `User.name` | written at transition | history stays attributable after deactivation |
| `DeploymentRun.commentCount` | `DeploymentComment` | `$inc` on create/delete | list badges |
| `DeploymentRun.durationMs` | timestamps | written once on terminal transition | sortable, avoids per-row math |
| `Project.deploymentCount` / `lastDeploymentAt` | `DeploymentRun` | `$inc` on create; nightly reconcile | project cards |
| `TemplateVersion.itemCount` / `requiredCount` / `sectionCount` | embedded arrays | recomputed on every version write | template list without walking arrays |
| `DeploymentComment.authorName` | `User.name` | written once | comments survive user deletion |
| `AuditLog.actorEmail` / `actorName` / `actorRoles` | `User` | written once | **must** be frozen — audit records who acted *at that time* |
| `ChecklistItemState.checkedByName` | `User.name` | written on toggle | tooltip without a join |
| `*.searchText` | own fields | recomputed on write | regex search fallback |

`AuditLog` denormalisation is the important one: it is not a cache, it is the record. If a user is renamed from *Priya K.* to *Priya Kulkarni*, the audit entry must still read as it did when written. Never backfill these.

A nightly `stats:rollup` job recomputes the reconcilable counters (`deploymentCount`, `completedItems`) and logs any drift as a warning. Silent drift is how denormalisation earns its bad reputation; measured drift is a bug report.

---

## 3.7 Working with Prisma on MongoDB

### Local development requires a replica set

Non-negotiable — `$transaction` fails without one.

```yaml
# docker-compose.yml
services:
  mongo:
    image: mongo:7
    command: ["mongod", "--replSet", "rs0", "--bind_ip_all"]
    ports: ["27017:27017"]
    healthcheck:
      test: mongosh --quiet --eval "try{rs.status().ok}catch(e){rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]}).ok}"
      interval: 5s
      retries: 20
    volumes: [mongo-data:/data/db]
volumes: { mongo-data: }
```

```
DATABASE_URL="mongodb://127.0.0.1:27017/deployment_checklist?replicaSet=rs0&directConnection=true"
```

**No Docker?** `npm run dev:db` starts an equivalent single-node replica set with no
installation, using `mongodb-memory-server` against a persistent `dbPath`. That is the
default local path in this repo — see [scripts/dev-db.ts](../scripts/dev-db.ts).

**One env file, and it is `.env`.** The three tools disagree: `next` reads `.env.local`
then `.env`; the **Prisma CLI reads `.env` only**; `tsx` reads neither. Prisma's constraint
decides it — `.env` is canonical, and `scripts/load-env.ts` gives standalone scripts the
same view Next has.

`src/lib/db/prisma.ts` asserts transaction capability at boot in development and fails loudly with this snippet in the error message, rather than surfacing as a mystery at the first item toggle.

### Schema changes

```bash
pnpm prisma db push          # apply schema (there is no `prisma migrate` for MongoDB)
pnpm prisma generate
pnpm tsx prisma/migrations-data/runner.ts   # TTL indexes, Atlas Search, backfills
pnpm tsx prisma/seed.ts
```

`db push` creates indexes but never drops data. Because MongoDB is schemaless, *removing* a field from the Prisma schema leaves it in existing documents — so a field rename needs a data migration, not just a schema edit. The runner exists for exactly this and is the reason `DataMigration` is in the schema.

### Soft delete without footguns

A Prisma Client extension excludes soft-deleted rows by default and requires opt-in to see them. Trash views pass `deletedAt: { not: null }` explicitly, so *forgetting* the filter is the safe outcome rather than a data leak.

> #### ⚠️ The trap that makes this harder than it looks
>
> **Prisma's MongoDB connector reads `where: { deletedAt: null }` as "field is PRESENT and null". It does not match documents where the field is absent** — even though raw MQL `{ deletedAt: null }` matches both. Measured, not assumed:
>
> | Query against a document with no `deletedAt` key | Result |
> |---|---|
> | Prisma `{ deletedAt: null }` | **0 rows** ← the trap |
> | Prisma `{ deletedAt: { isSet: false } }` | 1 row |
> | Prisma `{ deletedAt: { equals: null } }` | 0 rows |
> | raw MQL `{ deletedAt: null }` | 1 row |
>
> Because `deletedAt DateTime?` has no default, **Prisma omits it on insert.** So without a countermeasure every row ever created is invisible to every filtered read. There is no error — it presents as "the database is empty" while the documents are plainly there, and it took a failing end-to-end test to surface.
>
> **The countermeasure is a three-part invariant: the field must always exist.**
>
> 1. **Write** — the extension stamps `deletedAt: null` on `create`, `createMany` and `upsert.create`.
> 2. **Repair** — `prisma/migrations-data/0003-backfill-deleted-at.ts` sets it on documents written before the invariant existed.
> 3. **Verify** — `npm run doctor` counts documents missing the field across all twelve soft-deletable collections and fails if any exist.
>
> The alternative — `OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }]` on every read — would defend against write paths that bypass Prisma entirely, at the cost of permanent complexity on every list query. Enforcing and *verifying* the invariant is the better trade, and the doctor check is what makes it safe to rely on.
>
> The seed uses a **raw** `PrismaClient` (it needs cross-tenant access and cannot import the `server-only` extended client), so it is not covered by the extension and writes `deletedAt: null` explicitly at each create site.

```ts
// src/lib/db/soft-delete-extension.ts  (excerpt)
function withNotDeleted(args: AnyArgs): AnyArgs {
  // `'deletedAt' in where`, not a truthiness check: an explicit `deletedAt: null`
  // is a deliberate choice, and `{ not: null }` from a trash view must survive.
  if (args.where && 'deletedAt' in args.where) return args
  return { ...args, where: { ...args.where, deletedAt: null } }
}

// …and the half that makes the read filter correct at all:
function withDeletedAtColumn(args) {
  if (data && !('deletedAt' in data)) return { ...args, data: { ...data, deletedAt: null } }
  return args
}
```

`findUnique` is deliberately **not** filtered — Prisma restricts its `where` to unique fields, so appending `deletedAt` is a type error. Services resolve by `findFirst({ where: { id, deletedAt: null } })` wherever the guard matters.

### Tenant isolation without discipline

```ts
// src/lib/db/tenant-extension.ts  (excerpt)
prisma.$extends({
  query: {
    $allModels: {
      async $allOperations({ args, query, model, operation }) {
        const orgId = requestStore.getStore()?.organizationId
        if (!orgId || !TENANT_MODELS.has(model)) return query(args)

        if (READ_OPS.has(operation)) args.where = { ...args.where, organizationId: orgId }
        if (operation === 'create') args.data = { organizationId: orgId, ...args.data }
        return query(args)
      },
    },
  },
})
```

A developer who forgets `organizationId` gets correct behaviour anyway. Background jobs run outside the ALS scope and must pass `organizationId` explicitly — a lint rule flags `TENANT_MODELS` access inside `src/server/jobs/**` that does not.

### Global search

MongoDB Atlas Search is the right answer and is not managed by Prisma. `0002-atlas-search-index.ts` creates the index; the search service issues a `$search` aggregation via `$runCommandRaw`. When Atlas Search is unavailable (self-hosted, local dev), the service falls back to anchored, escaped regex against the indexed `searchText` fields:

```ts
const term = escapeRegex(q.trim().toLowerCase())
// anchored so the index is usable; unanchored /.../ would be a collection scan
where: { searchText: { contains: term, mode: 'insensitive' } }
```

The fallback is explicitly a fallback: it is fine at tens of thousands of documents and stops being fine well before millions. `SEARCH_BACKEND` env selects the strategy, and the search UI is identical either way.

---

## 3.8 Seed data

`prisma/seed.ts` is idempotent (upsert by natural key) and produces a system you can log into immediately:

- **Organization** — from `SEED_ORG_NAME`, slug `default`.
- **PermissionDefinition** — every entry in `src/lib/authz/permissions.ts`, so the role editor renders itself.
- **Roles** — `Admin` (`["*"]`, `isSystem`, `isSuperAdmin`), `Developer` (execute + read, `isDefault`), plus `QA`, `DevOps`, `Release Manager` as ready-made examples of extension with no code change.
- **Environments** — development, qa, uat, staging, production (`isProduction`, `requiresApprove`).
- **Admin user** — from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`, `status: ACTIVE`. Refuses to run in production unless `SEED_ALLOW_PRODUCTION=true`.
- **Projects** — Apex, Elevate, Internal Portal, Website.
- **`Production Deployment` template v1 (PUBLISHED)** — the ten sections and forty-nine items from the attached HTML, verbatim, with `Final Go / No-Go` items marked `isRequired` and `Backup taken immediately before migration runs` marked `evidenceRequired`. The reference design becomes real seeded data on first boot.
- **Settings** — `emailProvider: "console"` so a fresh clone works with no external accounts.
