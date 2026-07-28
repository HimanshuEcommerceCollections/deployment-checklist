# Deployment Checklist System — Architecture

> Release-control platform for multi-project deployment checklists.
> Next.js 15 · TypeScript · Tailwind v4 · shadcn/ui · MongoDB · Prisma · Auth.js v5

The attached `Pre Deployment checklist.html` is the **visual and behavioural reference only**. Its ten hardcoded sections are seeded as the `Production Deployment v1` template; its gauge, panel and GO/HOLD language survive as design tokens and components, not as markup.

---

## Document map

| # | Deliverable | Where |
|---|---|---|
| 1 | Complete system architecture | [docs/01-system-architecture.md](docs/01-system-architecture.md) |
| 2 | Folder structure | [docs/02-folder-structure.md](docs/02-folder-structure.md) |
| 3 | Database schema | [docs/03-data-model.md](docs/03-data-model.md) |
| 4 | Prisma schema | [prisma/schema.prisma](prisma/schema.prisma) *(complete, annotated)* |
| 5 | Entity relationship diagram | [docs/03-data-model.md#entity-relationship-diagram](docs/03-data-model.md#entity-relationship-diagram) |
| 6 | Authentication flow | [docs/04-authentication.md](docs/04-authentication.md) |
| 7 | Authorization design | [docs/05-authorization.md](docs/05-authorization.md) · [src/lib/authz/](src/lib/authz/) |
| 8 | API design | [docs/06-api-design.md](docs/06-api-design.md) |
| 9 | UI component hierarchy | [docs/07-ui-architecture.md](docs/07-ui-architecture.md) |
| 10 | State management strategy | [docs/07-ui-architecture.md#state-management](docs/07-ui-architecture.md#state-management) |
| 11 | Email abstraction | [docs/08-abstractions.md#1-notifications](docs/08-abstractions.md#1-notifications) · [src/lib/notifications/](src/lib/notifications/) |
| 12 | File storage abstraction | [docs/08-abstractions.md#2-file-storage](docs/08-abstractions.md#2-file-storage) · [src/lib/storage/](src/lib/storage/) |
| 13 | Audit logging strategy | [docs/09-audit-logging.md](docs/09-audit-logging.md) · [src/lib/audit/](src/lib/audit/) |
| 14 | Deployment lifecycle | [docs/10-deployment-lifecycle.md](docs/10-deployment-lifecycle.md) |
| 15 | MongoDB collection design | [docs/03-data-model.md#collection-design](docs/03-data-model.md#collection-design) |
| 16 | Performance optimizations | [docs/11-performance.md](docs/11-performance.md) |
| 17 | Security best practices | [docs/12-security.md](docs/12-security.md) |
| 18 | Senior-architect recommendations | [docs/13-recommendations.md](docs/13-recommendations.md) |

---

## The five decisions that shape everything else

Everything below is downstream of these. If you disagree with one, that is the conversation to have before code is written.

### 1. The checklist snapshot is embedded; its *state* is not

A `DeploymentRun` embeds a frozen `ChecklistSnapshot` (sections, items, labels, order, required flags). Nothing in the execution path ever reads `TemplateVersion`. Immutability is therefore a property of the data shape, not of a rule someone has to remember.

But Prisma **cannot update one element of an embedded array by predicate** — it rewrites the whole array. Two engineers ticking different items in the same second would silently clobber each other. So mutable per-item state (`checked`, `checkedBy`, `note`, evidence) lives in its own tiny-document collection, `ChecklistItemState`, with a unique index on `(deploymentId, itemId)`.

Result: immutability by construction, plus atomic per-item writes, optimistic concurrency, and a natural per-item audit trail. This is the single most important design decision in the system — [docs/03](docs/03-data-model.md#the-snapshot-pattern) explains the alternatives considered.

### 2. Roles are data; the permission vocabulary is code

Your brief says "permissions should not be hardcoded". The honest, workable version of that:

- **Permission strings are a code-declared catalog** (`src/lib/authz/permissions.ts`), seeded into `PermissionDefinition` so the admin UI can render them with groups and descriptions. They must be code, because code references them — a permission no code checks is decoration.
- **Roles are documents** with a `permissions: string[]` array. Adding *QA*, *DevOps*, *Release Manager* is data entry, requires no deploy, and touches no business logic.
- **Business logic never sees a role name.** The only authorization primitive is `can(ctx, "deployment.complete", { projectId })`. Grep the codebase for `=== "admin"` and you should get zero hits — enforced by an ESLint rule.
- Grants are two-level: org-wide (`User.roleIds`) and project-scoped (`Membership`). Effective permissions are the union.

[docs/05](docs/05-authorization.md)

### 3. Server Actions and REST are two doors into one service layer

Mutations from our own UI go through Server Actions; anything programmatic (CI/CD, exports, future mobile, integrations) goes through `/api/v1` route handlers. Both are **thin transports** that call the same `DeploymentService`, `TemplateService`, `ProjectService`. Business rules, permission checks, audit writes, and outbox enqueues live in the service layer and cannot be bypassed by choosing a different door.

[docs/06](docs/06-api-design.md)

### 4. `organizationId` on every tenant-scoped row, from commit one

Multi-organization is on your future list. Retrofitting tenancy into a live system is one of the most expensive migrations in software; adding an always-populated `organizationId` now costs a few bytes per document and one index prefix. Every tenant-scoped model has it, every index leads with it, and a Prisma Client extension injects it from `AsyncLocalStorage` so a developer *cannot* forget the filter.

[docs/13](docs/13-recommendations.md#1-multi-tenancy-now-not-later)

### 5. Notification channels sit *above* email providers

Your brief nests Slack under the email abstraction. They are siblings, not variants — Slack has no subject line and no recipient list. Two layers instead of one:

```
DomainEvent ──▶ NotificationDispatcher ──▶ NotificationChannel[]
                                            ├── EmailChannel ──▶ EmailProvider
                                            │                     ├── GmailSmtpProvider
                                            │                     ├── SmtpProvider
                                            │                     ├── ResendProvider  (later)
                                            │                     ├── SesProvider     (later)
                                            │                     └── ConsoleProvider (dev)
                                            ├── SlackChannel     (later)
                                            ├── TeamsChannel     (later)
                                            └── WebhookChannel   (later)
```

Adding Slack becomes one new `NotificationChannel` implementation and zero changes to `DeploymentService`. Everything is enqueued to a `NotificationOutbox` first, so delivery is retryable, idempotent, inspectable, and never blocks a request.

[docs/08](docs/08-abstractions.md#1-notifications)

---

## System at a glance

```
                        ┌──────────────────────────────────────────┐
   Browser              │  Next.js 15 App Router (Node runtime)    │
   ┌──────────┐         │                                          │
   │ RSC HTML │◀────────│  app/(auth)      login / invite / reset  │
   │ + island │         │  app/(app)       console, history, dash  │
   │  clients │────────▶│  app/(admin)     projects, templates,    │
   └──────────┘  action │                  users, roles, audit     │
        │               │  app/api/v1      REST for machines       │
        │ fetch         └───────────────┬──────────────────────────┘
        ▼                               │
   ┌──────────┐                         ▼
   │ CI / CD  │──── REST ──▶  ┌───────────────────────────────┐
   │ webhooks │               │  Application services         │
   └──────────┘               │  ─ permission guard           │
                              │  ─ Zod validation             │
                              │  ─ domain rules / state m/c   │
                              │  ─ audit emit                 │
                              │  ─ outbox enqueue             │
                              └────┬──────────────┬───────────┘
                                   │              │
                    ┌──────────────▼──┐   ┌───────▼──────────────┐
                    │ Prisma / Mongo  │   │ Ports (interfaces)   │
                    │  replica set    │   │  EmailProvider       │
                    │  Atlas + PITR   │   │  StorageProvider     │
                    └─────────────────┘   │  NotificationChannel │
                                          │  Clock / IdGen       │
                                          │  RateLimiter         │
                                          └───────┬──────────────┘
                                                  │
                              ┌───────────────────┴─────────────────┐
                              │ Gmail SMTP · Local disk / S3 · …    │
                              └─────────────────────────────────────┘

   Background (Vercel Cron or a worker): outbox drain · daily rollups
                                        · token & lock sweep · orphan file reaper
```

Four layers, dependencies pointing one way only:

| Layer | Knows about | Never imports |
|---|---|---|
| **Domain** — entities, state machine, policies, pure functions | nothing external | Prisma, React, Next |
| **Application** — services, use cases, ports | domain + port interfaces | concrete providers, React |
| **Infrastructure** — Prisma repos, Gmail, S3, Redis | application ports | UI |
| **Presentation** — RSC pages, actions, route handlers, components | application services | Prisma directly |

The rule that keeps this honest: **only `src/infrastructure/**` and `src/lib/db/**` may import `@prisma/client`.** Enforced by `eslint-plugin-boundaries` in CI, not by convention.

---

## Repository layout (top level)

```
deployment-checklist/
├── prisma/schema.prisma          ← complete, annotated
├── prisma/seed.ts                ← roles, permissions, admin, HTML template as v1
├── prisma/migrations-data/       ← hand-rolled data migrations (Mongo has no prisma migrate)
├── docs/                         ← this architecture set + ADRs
├── src/
│   ├── app/                      ← routes only; no business logic
│   ├── features/                 ← vertical slices: deployments, templates, projects, …
│   ├── domain/                   ← pure business rules
│   ├── lib/                      ← authz, audit, notifications, storage, db, http, crypto
│   ├── components/               ← ui/ (shadcn) + shared composites
│   └── server/                   ← container, context, ALS, cron entrypoints
└── tests/                        ← unit · integration (mongodb-memory-server RS) · e2e
```

Full tree with per-directory rules and a "where does this file go?" decision table: [docs/02](docs/02-folder-structure.md).

---

## Deployment lifecycle in one diagram

```
                       ┌───────────────────────────────────┐
                       │              DRAFT                │  snapshot taken at create
                       └──┬──────────────────────────┬─────┘
              start ┌─────▼─────┐            cancel  │
                    │IN_PROGRESS│◀──── unblock ──┐   │
                    └──┬───┬───┬┘                │   │
             block     │   │   │  fail           │   │
                 ┌─────▼─┐ │ ┌─▼──────┐    ┌─────┴───▼─┐
                 │BLOCKED│ │ │ FAILED │    │ CANCELLED │
                 └───────┘ │ └───┬────┘    └───────────┘
        completion gate ───┤     │ rollback
                    ┌──────▼───┐ │  ┌──────────────┐
                    │COMPLETED │─┴─▶│ ROLLED_BACK  │
                    └──────────┘    └──────────────┘
```

`GO` / `HOLD` from the HTML is **not a status** — it is a computed *readiness gate* derived from the completion policy (`ALL_ITEMS` · `ALL_REQUIRED` · `MANUAL`). A run can be `IN_PROGRESS` and `GO`; only then may someone with `deployment.complete` close it.

Two corrections to the brief, both adopted: your notification list mentions **Deployment Failed** but your status list omitted `FAILED`, and rollback workflows appear under future features while `ROLLED_BACK` is cheap to model now. Both are in the schema — full transition table, guards, and side effects in [docs/10](docs/10-deployment-lifecycle.md).

---

## Non-negotiables before this goes to production

Ordered by cost of getting them wrong. Detail in [docs/13](docs/13-recommendations.md#production-readiness-gate).

1. **MongoDB must be a replica set.** Prisma interactive transactions require one. Local dev too — `mongod --replSet rs0` or Atlas. Item toggles, run creation, and audit writes rely on it.
2. **Environment validation at boot** (`@t3-oss/env-nextjs` + Zod). A missing `SECRET_ENCRYPTION_KEY` must fail the build, not the first password reset at 2am.
3. **Audit collection hardened at the database user level** — `insert` + `find` only. Application-level immutability is a promise; a DB grant is a guarantee.
4. **SMTP password and API keys encrypted at rest** (AES-256-GCM, key from env/KMS), redacted from every API response, log line, and audit diff.
5. **A rate limiter that survives horizontal scale.** In-process counters are theatre on serverless. Redis, or the `RateLimit` collection with a TTL index.
6. **The data-migration runner**, because `prisma migrate` does not support MongoDB and you will need backfills.
7. **A restore drill.** Atlas PITR configured *and* a documented, rehearsed restore. An untested backup is not a backup.

---

## Known gotchas that will bite otherwise

| Area | Gotcha | Mitigation |
|---|---|---|
| Prisma + Mongo | No `prisma migrate`; `db push` only | Own migration runner + `DataMigration` ledger |
| Prisma + Mongo | No positional update on embedded arrays | Mutable state in its own collection |
| Prisma + Mongo | Transactions need a replica set | Enforced in `docker-compose` + a boot check |
| Auth.js v5 | Credentials provider **cannot** use database sessions | JWT + `sessionEpoch` for instant revocation |
| Gmail SMTP | Rewrites `From` to the authenticated account; ~500/day; needs an App Password | `emailFromAddr` validated against SMTP user; `emailDailyCap`; migrate to Resend/SES before scale |
| Vercel | 4.5 MB request body limit | Presigned direct-to-provider uploads |
| Serverless | Connection storms exhaust the Mongo pool | Prisma singleton, small `maxPoolSize`, consider Accelerate |
| Markdown comments | Stored markdown rendered to HTML = XSS surface | Store raw, sanitise at render, strict CSP |
| Timezones | "Deployments today" is ambiguous | Store UTC, bucket rollups by UTC day, render in `Setting.timezone` |
| Prisma + Mongo | **`deletedAt: null` does not match documents where the field is absent** — every row becomes invisible, silently | Extension stamps it on create; migration backfills; `npm run doctor` verifies. [docs/03](docs/03-data-model.md#soft-delete-without-footguns) |
| Prisma + Mongo | A plain index and a TTL index cannot share a key (error 85) | `@@index([expiresAt])` removed from TTL'd models; migration owns the key and heals conflicts |
| Prisma + Mongo | No cascade deletes — deleting a parent with children is refused | Deliberate; explicit service routines, soft delete by default |
| Auth.js v5 | `authorize` receives Auth.js's own `csrfToken`/`callbackUrl`; a `.strict()` schema rejects the payload and every sign-in fails opaquely | Separate non-strict `CredentialsSchema` for that boundary only |
| Next 15 | `next build` sets `NODE_ENV=production`, so production *policy* checks fail on a build machine with no secrets | Shape validated at build, policy at runtime boot (`instrumentation.ts`) |
| Next 15 | `instrumentation.ts` cannot import Prisma (own entry, no `serverExternalPackages`) | Env validation only; DB checks in `npm run doctor` |
| Next 15 | pino `transport` runs in a worker thread the bundler cannot trace | Log synchronously to stdout; pipe through `pino-pretty` |
| Tooling | Prisma CLI reads `.env` only; `next` reads both; `tsx` reads neither | `.env` is canonical; `scripts/load-env.ts` for scripts |

---

## Suggested build order

Each phase ships something demonstrable and leaves the system deployable.
**Phases 0 and 1 are complete and verified** — 51 tests, 18/18 end-to-end smoke checks, clean
build. See [README](README.md) to run it.

| Phase | Scope | Why here |
|---|---|---|
| **0. Foundation** ✅ | repo, env validation, Prisma + replica set, Tailwind v4 theme from the HTML, shadcn, CI, seed | nothing works without it |
| **1. Identity** ✅ | Auth.js credentials, invite → accept → password, reset, permission catalog + guard, audit core | every later feature calls `can()` and `audit()` |
| **2. Projects & environments** | CRUD, soft delete + restore, memberships | deployments need a project |
| **3. Templates** | template + versions, embedded section/item editor, reorder, duplicate, publish, version diff | deployments need a template to snapshot |
| **4. The console** | run creation with snapshot, `ChecklistItemState`, optimistic toggles, gauge, readiness gate, state machine | the actual product; the HTML made real |
| **5. Collaboration** | comments (markdown), attachments via `StorageProvider`, deployment timeline from audit | fits the run detail page already built |
| **6. Visibility** | history grid (search/filter/sort/paginate/export), dashboard, global search | needs data from phase 4 to be meaningful |
| **7. Admin & settings** | users, roles, environments, settings, audit viewer, restore bin | admin surface over everything above |
| **8. Hardening** | rate limits, CSP + headers, a11y audit, load test, rollups, runbook, restore drill | last, but before go-live |

---

## Reading order

New to the codebase: [01](docs/01-system-architecture.md) → [03](docs/03-data-model.md) → [10](docs/10-deployment-lifecycle.md) → [02](docs/02-folder-structure.md).

Building a feature: [02](docs/02-folder-structure.md) → [05](docs/05-authorization.md) → [06](docs/06-api-design.md) → [09](docs/09-audit-logging.md).

Reviewing for go-live: [12](docs/12-security.md) → [11](docs/11-performance.md) → [13](docs/13-recommendations.md).
