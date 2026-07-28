# 1 — System Architecture

## 1.1 Architectural style

**Feature-sliced Clean Architecture inside a single Next.js application.**

Not microservices. A deployment-checklist tool for an internal engineering org has one transactional boundary, one user base, and a request volume measured in hundreds per day. A modular monolith with strictly enforced internal seams gives you every benefit people reach for microservices to get — independent reasoning, replaceable infrastructure, testable domain logic — with none of the distributed-systems tax. The seams are placed so that *if* a piece ever needs to leave (the notification worker is the likeliest candidate), it can leave without a rewrite.

Two organising axes, used together:

- **Horizontal layers** enforce dependency direction (domain ← application ← infrastructure/presentation).
- **Vertical feature slices** keep everything about *deployments* in one place, so a change to deployments touches one directory.

```
                 features/deployments   features/templates   features/projects
                 ─────────────────────  ──────────────────   ────────────────
  presentation │  page, actions, ui    │  page, actions, ui │  …
  application  │  DeploymentService    │  TemplateService   │  …
  domain       │  state machine,       │  version rules,    │  …
               │  readiness gate       │  reorder rules     │
  infrastructure ──────── shared: Prisma repos, ports, adapters ──────────
```

## 1.2 Layers and their contracts

### Domain — `src/domain/`

Pure TypeScript. No imports from `@prisma/client`, `react`, `next`, or any provider SDK. This is where the rules that a whiteboard conversation would produce live:

- The deployment state machine (which transitions exist, what guards them).
- The readiness gate (given a snapshot, item states, and a completion policy → `GO` | `HOLD` | `BLOCKED`, plus *why*).
- Template version rules (a published version is frozen; editing clones to a draft).
- Permission evaluation (given effective permissions and a required permission → boolean, wildcard-aware).
- Value objects: `SemanticVersion`, `EmailAddress`, `Slug`, `StorageKey`.

Everything here is synchronous and trivially unit-testable. If a rule needs a database to test, it is in the wrong layer.

```ts
// src/domain/deployments/readiness.ts — no I/O, no framework
export function evaluateReadiness(input: {
  snapshot: ChecklistSnapshot
  states: Map<string, { checked: boolean; skipped: boolean }>
  policy: CompletionPolicy
}): Readiness {
  const items = flattenItems(input.snapshot).filter((i) => !input.states.get(i.id)?.skipped)
  const gating = input.policy === 'ALL_REQUIRED' ? items.filter((i) => i.isRequired) : items
  const outstanding = gating.filter((i) => !input.states.get(i.id)?.checked)

  if (input.policy === 'MANUAL') return { state: 'GO', outstanding: [], reason: 'manual-policy' }
  return outstanding.length === 0
    ? { state: 'GO', outstanding: [], reason: 'all-gating-items-complete' }
    : { state: 'HOLD', outstanding, reason: `${outstanding.length} gating item(s) outstanding` }
}
```

### Application — `src/features/*/server/` and `src/application/`

Use-case orchestration. A service method is one business transaction:

1. Resolve the request context (actor, org, effective permissions).
2. Authorize — `requirePermission(ctx, PERMISSIONS.deployment.complete, { projectId })`.
3. Validate input with Zod (the same schema the form uses).
4. Load state through a repository.
5. Apply a domain rule.
6. Persist inside a transaction.
7. Emit audit entries and domain events.
8. Return a typed `Result`.

Services depend on **ports** (interfaces), never on concrete providers:

```ts
export interface DeploymentServiceDeps {
  db: PrismaClient
  audit: AuditRecorder
  events: EventBus
  clock: Clock          // injected so tests don't sleep and rollups are deterministic
  ids: IdGenerator      // injected so snapshots are reproducible in tests
}
```

`Clock` and `IdGenerator` as ports look fussy until you write the first test that asserts on `durationMs`.

### Infrastructure — `src/infrastructure/`, `src/lib/db/`

The only place `@prisma/client` may be imported, plus every adapter: `GmailSmtpProvider`, `S3StorageProvider`, `RedisRateLimiter`, `MongoRateLimiter`, `ReactEmailRenderer`. Each implements a port. Swapping one is a one-line change in the container.

### Presentation — `src/app/`, `src/components/`, `src/features/*/components/`

Routes, Server Actions, route handlers, React components. Actions and handlers are **thin**: parse, call a service, map the `Result` to a response or a form state. A Server Action longer than about twenty lines is usually holding business logic that belongs in a service.

### Enforcing the boundaries

Conventions decay. These do not:

```js
// eslint.config.js — excerpt
'boundaries/element-types': ['error', {
  default: 'disallow',
  rules: [
    { from: 'domain',         allow: ['domain'] },
    { from: 'application',    allow: ['domain', 'application', 'ports'] },
    { from: 'infrastructure', allow: ['domain', 'ports', 'infrastructure', 'db'] },
    { from: 'presentation',   allow: ['application', 'domain', 'components', 'ports'] },
  ],
}],
'no-restricted-imports': ['error', {
  paths: [{
    name: '@prisma/client',
    message: 'Import Prisma only in src/infrastructure/** or src/lib/db/**.',
  }],
}],
```

Plus a custom rule banning role-name comparisons, so decision #2 in [ARCHITECTURE.md](../ARCHITECTURE.md) cannot rot:

```js
'no-restricted-syntax': ['error', {
  selector: 'BinaryExpression[operator="==="] > MemberExpression[property.name=/^(role|roleKey|roleName)$/]',
  message: 'Never branch on role identity. Use can(ctx, PERMISSIONS.x).',
}],
```

## 1.3 Request lifecycle

### A page render (read path)

```
GET /projects/apex/deployments/APEX-142
   │
   ├─ middleware.ts  (Edge)
   │    verify JWT signature + expiry only — no DB, no permission logic
   │    unauthenticated → 302 /login?next=…
   │
   ├─ app/(app)/layout.tsx  (RSC)
   │    getRequestContext()   ← React cache(); ONE DB read per request
   │      → user, sessionEpoch check, global + project permissions, settings
   │    AsyncLocalStorage.run({ orgId, userId, requestId }, …)
   │
   ├─ page.tsx  (RSC)
   │    requirePermission(ctx, 'deployment.read', { projectId })
   │    const run = await deploymentService.getRunDetail(ctx, ref)
   │      → single Prisma query with explicit select
   │      → ChecklistItemState fetched once, keyed by itemId
   │      → readiness computed in the domain layer, server-side
   │
   ├─ <Suspense> boundaries stream comments, attachments, timeline independently
   │
   └─ Client islands hydrate: <ChecklistItemToggle>, <StatusActions>, <CommentForm>
```

The permission set is resolved **once per request** and passed down through RSC props. There is no permission check that costs a database round trip inside a loop.

### A mutation (write path)

```
<ChecklistItemToggle> onCheckedChange
   │
   ├─ useOptimistic → checkbox flips instantly, gauge advances instantly
   │
   ├─ toggleChecklistItem(runId, itemId, checked, revision)   ← Server Action
   │    │  Auth.js CSRF/origin check happens before our code runs
   │    ├─ ctx = await getRequestContext()
   │    ├─ requirePermission(ctx, 'deployment.execute', { projectId })
   │    ├─ ToggleItemSchema.parse(input)
   │    └─ deploymentService.toggleItem(ctx, input)
   │         └─ $transaction:
   │              1. updateMany ChecklistItemState
   │                 where { deploymentId, itemId, revision }   ← optimistic guard
   │                 data  { checked, checkedById, checkedAt, revision: { increment: 1 } }
   │              2. if count === 0 → CONFLICT (stale client; return fresh state)
   │              3. update DeploymentRun counters with { increment: ±1 }
   │              4. audit.record('deployment.item.checked', { from, to })
   │
   ├─ revalidateTag(`deployment:${runId}`)
   │
   └─ after(() => events.publish('deployment.readiness.changed'))   ← Next 15 `after()`
        runs post-response; may enqueue outbox rows, never delays the user
```

The optimistic guard on `revision` is what makes concurrent editing safe. `updateMany` returning `count: 0` means someone else moved first — the action returns the authoritative state and the optimistic update reconciles. No lost writes, no pessimistic locks, no polling.

## 1.4 Runtime topology

| Concern | Choice | Reasoning |
|---|---|---|
| Hosting | Vercel (or any Node host / container) | App Router + Server Actions are first-class; nothing here requires Vercel specifically |
| Runtime | **Node.js** for all app routes | Argon2, Nodemailer, Prisma, and the crypto helpers are not Edge-compatible |
| Edge | `middleware.ts` only | Cheap JWT presence/signature check for routing; never authorization |
| Database | MongoDB Atlas M10+, **replica set** | Prisma interactive transactions require it; PITR needs a paid tier |
| Cache | Next.js Data Cache + tags; optional Upstash Redis | Redis becomes necessary for rate limits at multi-instance scale |
| Files | `local` in dev → S3-compatible in prod | Behind `StorageProvider`; swap is config-only |
| Email | Gmail SMTP → Resend/SES | Behind `EmailProvider`; outbox makes the cutover invisible |
| Background | Vercel Cron (or a small worker container) | Outbox drain, rollups, sweeps, orphan reaper |

### Background jobs

| Job | Cadence | Purpose |
|---|---|---|
| `outbox:drain` | every minute | Claim `PENDING` rows past `nextAttemptAt`, send, backoff on failure |
| `stats:rollup` | hourly + nightly reconcile | Maintain `DeploymentDailyStat` |
| `tokens:sweep` | hourly | Expire invitations, purge consumed `AuthToken`s |
| `files:reap` | nightly | Delete provider objects for attachments soft-deleted > N days |
| `locks:sweep` | every 5 min | Release `JobLock` rows past `expiresAt` |
| `audit:archive` | nightly (opt-in) | Cold-storage export when `auditRetentionDays > 0` |

All wrapped in `withJobLock(name, ttl, fn)` against the `JobLock` collection, because cron platforms deliver at-least-once and a double outbox drain would double-send email.

## 1.5 Extension seams

Each future feature on your list has a named place to land. Nothing below requires touching `DeploymentService`.

| Future feature | Seam |
|---|---|
| Slack / Teams | new `NotificationChannel` implementation, registered in the dispatcher |
| GitHub / GitLab / Jenkins / Azure DevOps / Jira | `IntegrationProvider` port + `ExternalLink` records on a run |
| Deployment approvals, multi-stage, digital signatures | new `PENDING_APPROVAL` state in the transition table + an `Approval` collection; the gate already exists as a domain function |
| Rollback workflows | `ROLLED_BACK` + `rollbackOfId` already modelled |
| Release calendar | `scheduledAt` already indexed; a read-model view |
| Analytics | `DeploymentDailyStat` plus `sourceItemId` lineage on snapshot items |
| Environment-specific checklists | `TemplateItem.environmentKeys` already filters at snapshot time |
| Teams | a `Team` collection between `User` and `Membership`; the permission resolver gains one union term |
| Multiple organizations | `organizationId` already present and index-leading; flip the ALS resolver to read from the subdomain |
| Mobile | `/api/v1` already exists and is the same service layer |
| Real-time collaboration | `useDeploymentChannel()` hook is already the seam; swap polling for SSE |

## 1.6 Explicitly rejected alternatives

Worth recording so they are not re-litigated in six months.

**Referencing live template items from deployments.** Simplest schema, but an admin editing a template would silently rewrite deployment history. This is the requirement the snapshot exists to satisfy.

**Storing item check state inside the embedded snapshot.** One document, atomic reads, very tempting. Fails on concurrent writes because Prisma rewrites whole composite arrays, and mixes immutable definition with mutable state in one field. See [docs/03](03-data-model.md#the-snapshot-pattern).

**Sections and items as top-level collections.** Adds three collections and an N-document write for every reorder, to model things that have no independent lifecycle and are always read with their parent. Embedded is correct *for now*; the promotion path (an item catalog) is documented and cheap because of the snapshot layer.

**tRPC.** Excellent, but Server Actions plus a typed service layer already give end-to-end type safety, and the REST surface has to exist anyway for CI/CD callers. Two RPC mechanisms is one too many.

**A client cache library (React Query / SWR) as the primary data layer.** RSC plus `revalidateTag` covers the read path with less code and no cache-coherence bugs. Reach for React Query only when genuinely client-driven polling arrives.

**Redux / heavy global state.** There is almost no cross-page client state here. Filters belong in the URL, server data belongs on the server, forms belong to React Hook Form. See [docs/07](07-ui-architecture.md#state-management).

**Event sourcing for the audit trail.** Attractive given the immutability requirement, but the write model would be considerably more complex than the domain warrants. An append-only audit collection with structured diffs gives you the same forensic value at a fraction of the cost.
