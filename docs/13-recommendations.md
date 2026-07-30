# 13 — Recommendations

Deliverable 18: *anything else you would recommend as a senior software architect.*

These are things not in the brief that I would insist on, or push back on, before writing code. Ordered by cost of getting them wrong.

---

## 1. Multi-tenancy now, not later

*"Multiple organizations"* is on your future list. Retrofitting tenancy into a live system with real data is one of the most expensive migrations in software: every collection needs a backfill, every index needs rebuilding, every query needs auditing, and until the last one is found you have a cross-tenant data leak.

Adding it now costs 12 bytes per document and one index prefix:

- `organizationId` on every tenant-scoped model — already in the schema.
- Every compound index leads with it — already done.
- A Prisma Client extension injects it from `AsyncLocalStorage`, so a developer *cannot* forget the filter.
- One seeded organisation. `Organization` exists, is referenced, and does nothing visible.

When multi-org arrives, the work is: resolve `organizationId` from a subdomain or a user's org membership instead of a constant, add an org switcher, and scope the invite flow. Days, not quarters. This is the single highest-leverage recommendation in this document.

The same argument, weaker but still positive, applies to **Teams**: don't build them, but know that `resolvePermissions` gains exactly one union term when they arrive, which is why permission resolution is a pure function over grant lists rather than a query.

---

## 2. Three things in the brief I would change

### `FAILED` belongs in the status list

Your notification list includes *Deployment Failed*; your status list stops at Draft / In Progress / Completed / Cancelled. Without `FAILED` there is nowhere to record "we shipped and it broke", and the failure email has no state to fire from. `CANCELLED` is not a substitute — cancelling means the release never went out. Conflating them makes your failure-rate metric meaningless, which is the one metric a release tool exists to produce. Added, along with `BLOCKED` and `ROLLED_BACK`. See [docs/10](10-deployment-lifecycle.md#12-two-additions-to-the-brief).

### Slack is not an email provider

The brief nests Slack under the email abstraction as a future replacement. They are siblings: Slack has no subject line, no cc/bcc, no HTML body. One interface covering both produces an `EmailProvider` with half its fields permanently ignored, and the first Slack implementation would either bend the interface or bypass it. Two layers — `NotificationChannel` above `EmailProvider` — costs one extra interface today and saves the refactor. See [docs/08](08-abstractions.md#1-notifications).

### "Permissions should not be hardcoded" needs one clarification

Permission *strings* must live in code, because code references them; a permission invented at runtime can never be enforced by anything. What must not be hardcoded — and here is not — is the mapping from role to permission and the check itself. Roles are data, grants are data, and no business logic ever mentions a role name (enforced by a lint rule). That delivers what the requirement is actually after: creating a *Release Manager* role is a form submission. See [docs/05](05-authorization.md#51-what-not-hardcoded-means-here).

---

## 3. Things you will need that the brief does not mention

Each of these came up while designing something you *did* ask for.

**Skip / not-applicable on checklist items.** "Migrations tested on a staging copy" is meaningless on a release with no schema change. Without a skip, people tick it anyway — and the moment the checklist contains one tick that means "not applicable", every tick is suspect and the artifact is worthless. `skipped` + `skipReason` + a permission + an audit entry. Non-negotiable in my view; it protects the integrity of the entire product.

**Required vs optional items.** Your ten HTML sections mix "PR approved" (blocking) with "Load testing done (if traffic-sensitive change)" (conditional). Without `isRequired`, the completion gate is all-or-nothing and teams either can't complete or stop taking it seriously. `isRequired` + three completion policies.

**Evidence on items.** "Backup taken immediately before migration runs" is the item you most want proof of. `evidenceRequired` forces a note before it can be ticked, with `deployment.item.override` for the exception. This turns the checklist from a claim into a record.

**A human-readable reference.** `APEX-142`, not `6503f9a1b2c8e4d5f6a7b8c9`. People discuss deployments in Slack and tickets. An ObjectId cannot be said out loud. `(projectId, sequence)` with an atomic `$inc`.

**Environment-scoped items.** "DNS/load balancer changes reviewed" does not apply to a dev deploy. `TemplateItem.environmentKeys` filters at snapshot time, so one template serves five environments instead of five near-duplicate templates that drift apart. Your future list has "environment-specific checklists" — it is nearly free now and expensive later.

**Print / PDF is a real feature, not a leftover.** The reference HTML had a print stylesheet, and I would keep it deliberately. A signed, completed checklist is an artifact teams file with a release and hand to auditors. Preserved in [globals.css](07-ui-architecture.md#71-design-tokens).

**Deployment templates ≠ deployment scope.** Consider a `scheduledAt`-driven release calendar early — it is already indexed. Teams that adopt a checklist tool ask for "what's shipping this week" within about a month.

---

## 4. Testing strategy

The domain layer's purity is what makes this affordable. Aim for a fast, boring suite rather than a comprehensive slow one.

| Layer | Tool | Target | What it covers |
|---|---|---|---|
| Domain | Vitest | ~95 % | state machine, readiness gate, permission evaluation, diffing, redaction, key building |
| Services | Vitest + `mongodb-memory-server` (replica set) | ~80 % | transactions, counters, snapshot construction, audit writes, conflict handling |
| API | Vitest + route handlers | key paths | validation, authorization, pagination, error mapping |
| E2E | Playwright | 6 journeys | the flows that must never break |
| A11y | `axe-core` via Playwright | 5 routes | fails the build on violations |

`MongoMemoryReplSet` — not `MongoMemoryServer`. A single node cannot run transactions, and the entire write path depends on them, so a plain in-memory server would leave your most important code untested.

The six E2E journeys: invite → accept → login · create run → tick all → complete · concurrent toggle conflict (two browser contexts) · template edit → publish → verify an in-flight run is unchanged · forgot → reset → old session rejected · soft delete → restore.

The fourth is the one I would write first. It is the guarantee the product is built on, and it is the one a well-meaning refactor is most likely to break — someone "optimises" the snapshot into a template reference and every test still passes except that one.

### Three conformance tests worth more than they look

Cheap AST greps that mechanically enforce properties which otherwise decay:

1. **Every mutating service method authorizes.** Fails on any method whose body has no `requirePermission`/`requireAny`/`requireOwnershipOr`.
2. **Every mutating service method audits.** "Every action should be logged" decays the moment one new endpoint forgets.
3. **Every permission in the catalog is enforced somewhere.** A permission nothing checks is a false promise in the admin UI.

---

## 5. CI/CD

```yaml
on: [pull_request, push]
jobs:
  verify:
    steps:
      - pnpm install --frozen-lockfile
      - pnpm prisma validate && pnpm prisma generate
      - pnpm typecheck            # tsc --noEmit
      - pnpm lint                 # includes the boundary + no-role-check rules
      - pnpm test:unit
      - pnpm test:integration     # mongodb-memory-server replica set
      - pnpm build
      - pnpm size-limit           # bundle budgets from docs/07
      - pnpm audit --audit-level=high
      - pnpm openapi:check        # committed spec matches generated
      - pnpm test:e2e             # main branch only
```

`openapi:check` deserves a mention: because the spec is generated from Zod, a diff in the committed file is a review surface for accidental breaking API changes. It catches "I widened this enum" before a consumer does.

Environments: preview per PR (isolated Atlas database, `console` email provider, `local` storage) → staging (production-shaped, real SMTP to a test inbox) → production (manual promotion).

**No `prisma migrate`, so `db push` runs as an explicit deploy step**, followed by the data-migration runner, before the new build is promoted. Because MongoDB is schemaless, additive changes are backwards-compatible and old instances tolerate new fields — which makes zero-downtime deploys easy and makes *destructive* changes uniquely dangerous. Rule: never remove or repurpose a field in the same release that stops writing it. Two releases, always.

---

## 6. The data-migration runner

`prisma migrate` does not support MongoDB. Without a substitute, backfills become one-off scripts someone runs by hand from a laptop, twice, in the wrong order.

```ts
// prisma/migrations-data/runner.ts
export async function runMigrations() {
  await withJobLock('data-migrations', 300_000, async () => {
    const applied = new Set((await db.dataMigration.findMany()).map((m) => m.name))

    for (const migration of MIGRATIONS) {          // ordered, explicit list
      if (applied.has(migration.name)) continue

      const started = Date.now()
      logger.info({ name: migration.name }, 'applying data migration')
      await migration.up(db)                        // must be idempotent

      await db.dataMigration.create({
        data: { name: migration.name, checksum: migration.checksum,
                durationMs: Date.now() - started, appliedBy: process.env.VERCEL_GIT_COMMIT_SHA },
      })
    }
  })
}
```

Every migration must be **idempotent** — it will be re-run when a deploy is retried. Runs under a lock, because two instances deploying concurrently is normal. The checksum catches an edited migration that has already been applied somewhere.

Already needed: TTL indexes (Prisma cannot express them), Atlas Search index creation, and `searchText` backfill.

---

## 7. Observability

Three things, and I would not launch without them.

**Structured logging** — pino, one line per request with `requestId`, `actorId`, route pattern, status, duration, `orgId`. Route *pattern*, not path, or ids explode log cardinality and every query becomes a scan.

**Error tracking** — Sentry with release tracking, source maps, `sendDefaultPii: false`, and a `beforeSend` scrubber. `requestId` on every event.

**Alerts** — these five, and resist adding more until something surprises you:

| Alert | Threshold | Why it matters |
|---|---|---|
| Error rate | > 1 % over 5 min | something broke |
| Outbox depth | > 500, or oldest > 15 min | invites and resets are silently not arriving |
| Outbox dead-letters | any | a password reset failed five times; someone is locked out |
| Counter drift (nightly) | any | the denormalisation contract broke |
| Job failure | any | a cron stopped and nothing is telling you |

The outbox alerts are the ones people forget. Email failing silently is the single most common way an invite-only tool becomes unusable — new users simply never arrive, and nobody files a ticket because they cannot log in to file one.

**Health endpoints:** `/api/health` (liveness, no DB) and `/api/ready` (readiness, pings the DB). Distinct, because a load balancer restarting instances during a database blip makes an outage worse.

---

## 8. Backups and the restore drill

Atlas continuous backup with PITR, retention ≥ 30 days. Then the part everyone skips:

**Rehearse a restore before launch, and once a quarter after.** Restore to a scratch cluster, point a staging deploy at it, confirm the app boots and a deployment renders. Record how long it took. An untested backup is not a backup — it is a hope with a monthly invoice.

Two specifics for this system:

- **`audit_logs` is the collection where losing an hour genuinely hurts.** Name it explicitly in the drill.

---

## 9. Documentation that survives the first six months

**ADRs** in `docs/adr/` — one page each: context, decision, consequences, alternatives rejected. Five to write immediately (the five decisions in [ARCHITECTURE.md](../ARCHITECTURE.md#the-five-decisions-that-shape-everything-else)). The value is not the decision; it is the *rejected alternatives*, so nobody re-litigates the snapshot design in six months without knowing why embedding mutable state fails.

**A runbook** — the four things someone will need at 2am: rotate a leaked secret · restore from backup · unlock a locked-out account · **recover when the last super-admin is locked out**. The last one is a script (`pnpm tsx scripts/grant-super-admin.ts <email>`) that must exist before you need it, because by definition you cannot fix it through the UI.

**`CLAUDE.md` / `CONTRIBUTING.md`** — the boundary rules, the "where does this file go" table from [docs/02](02-folder-structure.md#22-where-does-this-file-go), and the replica-set requirement. New contributors hit the transaction error on day one; a searchable answer saves each of them an afternoon.

---

## 10. Things I would deliberately not build yet

Each is on your future list and each is a real feature. The recommendation is *not now*, with the trigger that changes the answer.

| Feature | Why wait | Build when |
|---|---|---|
| Real-time collaboration (SSE/WS) | polling a run that changes a few times a minute is adequate; SSE on serverless has real operational cost | users complain, or > 20 concurrent editors |
| Approval workflows / multi-stage | needs real usage to know whether approval is per-run, per-environment, or per-item. Guessing produces a workflow engine nobody fits | a team asks with a concrete shape |
| Digital signatures | meaningful only with a compliance driver; otherwise it is a checkbox with extra steps | an auditor asks |
| GitHub / Jenkins / Jira integrations | each is a week and an OAuth app. Value depends entirely on which one your team lives in | someone names the one they want |
| Analytics dashboards | `sourceItemId` lineage and `DeploymentDailyStat` already capture the data. Build the charts once you know which question gets asked | after ~three months of real data |
| Mobile app | `/api/v1` exists; responsive web covers "tick an item from my phone" | genuine demand |
| Custom fields per project | `metadata: Json` is already on the core entities | a second team needs a field the first does not |
| Redis | the Mongo rate limiter is adequate below ~50 req/s | that threshold, or session storage arrives |
| Microservices | there is one transactional boundary and one team | not at this scale |

The discipline is *keep the seam, skip the implementation*. Every row above has a named seam in [docs/01](01-system-architecture.md#15-extension-seams). That is what makes "later" cheap without paying for it now.

---

## 11. Sequencing the build

Eight phases, each shipping something demonstrable and leaving the system deployable.

| Phase | Scope | Why here |
|---|---|---|
| **0. Foundation** | repo, env validation, Prisma + replica set, Tailwind theme from the HTML, shadcn, CI, seed | nothing works without it |
| **1. Identity** | Auth.js, invite → accept → password, reset, permission catalog + guard, audit core | every later feature calls `can()` and `audit()` |
| **2. Projects & environments** | CRUD, soft delete + restore, memberships | deployments need a project |
| **3. Templates** | template + versions, embedded editor, reorder, duplicate, publish, diff | deployments need a template to snapshot |
| **4. The console** | run creation + snapshot, item states, optimistic toggles, gauge, gate, state machine | the product; the HTML made real |
| **5. Collaboration** | comments, timeline | fits the page already built |
| **6. Visibility** | history grid, dashboard, global search | needs phase 4 data to be meaningful |
| **7. Admin & settings** | users, roles, environments, settings, audit viewer, trash | the surface over everything above |
| **8. Hardening** | rate limits, CSP, a11y audit, load test, rollups, runbook, restore drill | last, but before go-live |

Two notes on ordering. **Audit lands in phase 1, not phase 8** — retrofitting audit means revisiting every service, and "every action logged" is not achievable as a late addition. And **phase 4 is the demo** — if the schedule slips, cut phases 6 and 7 before touching 4, because a working console with a spreadsheet for history is a usable product, and a beautiful admin panel with no console is not.

---

## 12. Production readiness gate

The seven items I would block a launch on. Each is either irreversible or discovered at the worst possible moment.

1. **MongoDB is a replica set** — in every environment including local. Prisma transactions require one, and the entire write path depends on them. A boot-time assertion, not a wiki page.
2. **Environment validated at boot.** A missing `SECRET_ENCRYPTION_KEY` must fail the build, not the first password reset at 2am.
3. **`audit_logs` hardened at the database user level** — insert and find only. The application-level guard catches mistakes; the grant guarantees the property.
4. **Secrets encrypted at rest**, redacted from every API response, log line, and audit diff.
5. **Rate limiting that survives horizontal scale.** Verify it across two instances; in-process counters are theatre on serverless.
6. **The data-migration runner exists** before you need your first backfill.
7. **A rehearsed restore.** Not a configured backup — a restore you have actually performed and timed.

---

## 13. If I could give you only three sentences

Take the snapshot at run creation and never read a live template during execution — that one decision is what makes deployment history trustworthy, and everything else in this design is arranged to protect it.

Put `organizationId` on every row from the first commit, because it costs nothing now and a quarter later.

Build the audit trail in phase 1 with the rest of identity, because it is the one requirement that cannot be added afterwards without touching every service you have written.
