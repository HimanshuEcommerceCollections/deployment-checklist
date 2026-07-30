# 11 — Performance

Scale assumption: 200–500 users, 30 projects, ~20 deployments/day, ~8 M audit rows over three years. That is a small-data system, so the goal is not throughput — it is making sure nothing here is accidentally quadratic, and knowing which thresholds change the answers.

Where a decision only pays off past a threshold, the threshold is stated. Optimising for a scale you do not have is how a codebase becomes hard to change before it becomes fast.

---

## 11.1 Database

### The queries that matter

Three account for nearly all load. Each is designed to be a single index-covered operation.

**Console detail** — the hottest page.

```ts
// Two queries. No joins, no aggregation, no N+1.
const run = await db.deploymentRun.findFirst({
  where: { projectId, sequence, deletedAt: null },
  select: {
    id: true, reference: true, status: true, version: true, releaseNotes: true,
    environmentKey: true, environmentName: true, isProduction: true,
    totalItems: true, totalRequired: true, completedItems: true, completedRequired: true,
    startedAt: true, startedByName: true, completedAt: true, completedByName: true,
    durationMs: true, commentCount: true,
    checklist: true,                          // the embedded snapshot — free, same document
    project: { select: { id: true, name: true, slug: true, color: true } },
  },
})

const states = await db.checklistItemState.findMany({
  where: { deploymentId: run.id },
  orderBy: [{ sectionId: 'asc' }, { order: 'asc' }],   // served by the compound index
})
```

The snapshot arrives free because it lives in the same document. The `checked` state is ~120 small documents from one index range scan. Comments and the timeline stream separately behind `<Suspense>`, so the checklist never waits for them.

**History list** — the widest filter surface.

```ts
where: {
  ...projectFilter(ctx, PERMISSIONS.deployment.read),   // authorization IN the query
  deletedAt: null,
  ...(status && { status: { in: status } }),
  ...(from || to) && { createdAt: { gte: from, lte: to } },
}
```

Progress renders from the denormalised counters already on each row. Without them this page would aggregate `checklist_item_states` per row — 25 rows × 120 states = 3,000 documents to render one screen. That is the single most valuable denormalisation in the schema.

**Dashboard** — six numbers plus two lists.

Six `count()` calls in `Promise.all` against indexed predicates, plus two small `findMany`s. Wrapped in `unstable_cache` with a 60-second TTL and the `dashboard:<orgId>` tag, invalidated on terminal transitions. A dashboard that is 60 seconds stale is correct; a dashboard that costs six aggregations on every navigation is not.

> **Threshold:** above roughly 100 K runs, replace the `count()` calls with reads from `DeploymentDailyStat`. The collection and the hourly rollup job already exist for this; the switch is one query change in `dashboard/queries`.

### Index discipline

Every compound index follows **ESR** — Equality, then Sort, then Range:

```
(organizationId, status, createdAt↓)
 └ equality      └ equality └ sort+range
```

Getting the order wrong turns an index scan into an in-memory sort. MongoDB will happily do that and quietly get slower as data grows.

Two rules that keep index count honest:

- **A prefix of an existing index needs no index of its own.** `(organizationId, status, createdAt)` already serves `(organizationId, status)` and `(organizationId)`.
- **Every index costs write throughput and RAM.** Each is documented in [prisma/indexes.md](../prisma/indexes.md) with the query it serves; an index with no listed query is deleted.

`explain('executionStats')` in integration tests asserts `IXSCAN` and no `SORT` stage for the top ten queries. A regression is caught by a failing test rather than by a user.

### Anti-patterns actively prevented

| Anti-pattern | Prevention |
|---|---|
| `select *` | explicit `select` on every query; a lint rule flags `findMany` without one |
| N+1 | single-query joins via `select`, or a batched `findMany({ where: { id: { in } } })` + map |
| `skip` on large collections | cursor pagination on audit logs, comments, timelines |
| Unbounded `findMany` | every list has a clamped `take` |
| Aggregating in a loop | denormalised counters |
| Regex without an anchor | search terms are anchored and escaped; unanchored regex is a collection scan |
| Sorting an unindexed field | per-endpoint sort allowlists |
| Cascade deletes | soft delete + explicit service routines |

### Connections

```ts
// src/lib/db/prisma.ts
const client = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})

// The singleton matters in dev: hot reload creates a new client per reload and
// exhausts the connection pool within a minute or two of editing.
export const prisma = globalThis.__prisma ?? client
if (env.NODE_ENV !== 'production') globalThis.__prisma = prisma
```

Serverless needs a small pool per instance — `maxPoolSize=5` in the connection string. Fifty concurrent lambdas at the default pool size of 100 would try to open 5,000 connections against a cluster that permits 500. Above ~50 concurrent instances, Prisma Accelerate or a proxy becomes the answer; below that, a small pool is enough.

---

## 11.2 Caching

Four layers, each with an explicit invalidation story. A cache without one is a bug with a delay.

| Layer | Contents | TTL | Invalidated by |
|---|---|---|---|
| React `cache()` | request context, permissions | one request | end of request |
| `unstable_cache` | settings, roles, environments, permission catalog | 5 min | `revalidateTag` on write |
| Next Data Cache | dashboard stats, project lists | 60 s | `revalidateTag` on transition |
| Router cache | client-side navigation | 30 s | `router.refresh()`, action revalidation |

The request-scoped one earns the most. Without it, a console page with twelve permission checks would issue twelve identical user+roles queries:

```ts
export const getRequestContext = cache(async () => { /* one DB read per request */ })
```

Settings and roles are read on nearly every request and change a few times a year, so caching them removes two queries from every single page render:

```ts
export const getSettingsCached = (orgId: string) =>
  unstable_cache(
    () => db.setting.findUnique({ where: { organizationId: orgId } }),
    ['settings', orgId],
    { revalidate: 300, tags: [CacheTags.settings(orgId)] },
  )()
```

**Never cached:** deployment run detail (must be current during a release), checklist item states, audit logs, anything permission-dependent. The last is the important exclusion — a cache key that omits the actor is an authorization bypass waiting to be discovered.

---

## 11.3 Rendering

**Server Components by default.** Roughly six of thirty components in the console tree are client components. Markdown rendering in particular stays server-side, keeping a parser and sanitiser (~40 KB gzipped) out of the browser entirely.

**Streaming.** The checklist renders as soon as the run and item states load; comments and timeline arrive behind `<Suspense>`. The page's reason for existing is never blocked by a comment query.

**Optimistic mutations.** `useOptimistic` makes a tick feel instant. The reference HTML was instant because it wrote to `localStorage`; a network round trip must not make the rebuild feel worse.

**`after()` for side effects.** Notifications, event publication, and deferred audit writes run post-response. A slow SMTP handshake never shows up as checkbox latency.

### Bundle budgets

| Route | First Load JS | Measured | Target LCP |
|---|---|---|---|
| shared baseline | — | **102 kB** | — |
| `/login` | < 160 kB | 145 kB ✓ | < 1.0 s |
| `/dashboard` | < 200 kB | 183 kB ✓ | < 1.5 s |
| console | < 260 kB | not built yet | < 1.8 s |
| template editor | < 320 kB | not built yet | < 2.0 s |

**Revised against measurement.** The original targets (40–180 kB) were set before the
first build and did not account for the Next 15 + React 19 shared chunk, which is
**102 kB on its own** — so a 40 kB login page was never achievable. Budgets are now
expressed as *First Load JS* (baseline included), which is what `next build` reports and
therefore what CI can actually enforce. The numbers above leave roughly 40 % headroom over
current measurements.

Lazy-loaded, never in the shared chunk: markdown editor, dnd-kit (editor only), command palette, chart library (dashboard only), export helpers. Enforced by a `size-limit` check in CI — a budget nobody measures is a wish.

---

## 11.4 Exports

Exports are the most likely source of a memory incident, because they are the one operation whose size a user controls.

```ts
export const GET = withApi({
  permission: PERMISSIONS.deployment.export,
  rateLimit: { key: 'export', limit: 5, windowMs: 3_600_000 },
  handler: async ({ ctx, query }) => {
    const stream = new ReadableStream({
      async pull(controller) {
        // Cursor-paged batches of 500. Never `findMany()` the whole result set —
        // a 50,000-row export materialised in memory is how a serverless
        // function gets OOM-killed mid-download.
        const batch = await fetchBatch(ctx, query, cursor, 500)
        if (batch.length === 0) return controller.close()
        controller.enqueue(encoder.encode(toCsvRows(batch)))
        cursor = batch.at(-1)!.id
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="deployments-${stamp}.csv"`,
      },
    })
  },
})
```

Hard cap at 100,000 rows with a clear message rather than a timeout. Above that, the export becomes a queued job that emails a link — not built yet, but the outbox makes it a small addition when someone asks.

CSV injection is handled in `toCsvRows`: a cell beginning `=`, `+`, `-`, or `@` is prefixed with a tab. A release note starting `=HYPERLINK(...)` is a formula that executes when the export is opened in Excel.

---

## 11.5 Background jobs

| Job | Cadence | Cost | Purpose |
|---|---|---|---|
| `outbox:drain` | 1 min | 25 rows/run | send notifications |
| `stats:rollup` | hourly | small | maintain `DeploymentDailyStat` |
| `stats:reconcile` | nightly | full scan | verify denormalised counters; log drift |
| `tokens:sweep` | hourly | small | expire invitations, purge consumed tokens |
| `locks:sweep` | 5 min | trivial | release expired job locks |
| `audit:archive` | nightly, opt-in | large | cold-storage export before retention deletion |

All wrapped in `withJobLock(name, ttl, fn)`. Cron platforms deliver at-least-once, and a double outbox drain double-sends email.

The nightly reconcile is the safety net for §11.1's denormalisation. It recomputes `completedItems`, `commentCount`, and `Project.deploymentCount`, fixes any drift, and logs it as a warning. Silent drift is how denormalisation earns its reputation; measured drift is a bug report with a stack trace attached.

---

## 11.6 What to measure

Optimising without measurement is guessing. These are the numbers worth alerting on:

| Metric | Target | Alert |
|---|---|---|
| Console TTFB (p95) | < 300 ms | > 800 ms |
| Item toggle round trip (p95) | < 200 ms | > 600 ms |
| History query (p95) | < 150 ms | > 500 ms |
| Dashboard (p95, cold) | < 500 ms | > 1.5 s |
| Slow query log | none > 100 ms | any > 500 ms |
| Outbox depth | < 50 | > 500 or oldest > 15 min |
| Outbox dead-letters | 0 | any |
| Counter drift (nightly) | 0 | any |
| Error rate | < 0.1 % | > 1 % |

Instrumentation: structured access logs with `requestId` and duration, Prisma's `$on('query')` in development, Atlas Performance Advisor in production, Sentry for errors and traces, and Vercel Analytics for real-user LCP/INP.

Atlas Performance Advisor is worth a specific mention — it surfaces missing indexes from real traffic patterns, which is a better index list than anything derived from reading code.

---

## 11.7 Thresholds — when the answers change

Deliberately **not** built now, with the trigger for each:

| Current approach | Breaks at | Replace with |
|---|---|---|
| `count()` for dashboard | ~100 K runs | read `DeploymentDailyStat` |
| Regex `searchText` fallback | ~500 K docs | MongoDB Atlas Search (already the primary when available) |
| Offset pagination on admin tables | ~50 K rows/collection | cursor pagination |
| Mongo-backed rate limiter | ~50 req/s | Redis (Upstash) |
| In-process `EventBus` | integrations arrive | outbox-backed queue |
| Polling for run updates | user complaints, or >20 concurrent editors | SSE on `/deployments/:id/stream` |
| `audit_logs` as a normal collection | ~50 M docs | time-series collection or a dedicated store |
| Single Atlas cluster | not foreseeable at this scale | read replicas for analytics |

Each is a small, isolated change *because* the seam already exists — the dashboard reads through a query module, search reads through a service with a `SEARCH_BACKEND` switch, and the rate limiter is behind a port. The architecture pays for the future by keeping the boundary, not by building the implementation.
