# Deployment Checklist

Release-control platform for multi-project deployment checklists.
Next.js 15 · TypeScript · Tailwind v4 · shadcn/ui · MongoDB · Prisma · Auth.js v5

**Architecture:** [ARCHITECTURE.md](ARCHITECTURE.md) · **Design docs:** [docs/](docs/)

---

## Quick start

You need **Node ≥ 20.11** and nothing else — no Docker, no local MongoDB install.

```bash
npm install
cp .env.example .env
node -e "const c=require('crypto');for(const k of ['AUTH_SECRET','SECRET_ENCRYPTION_KEY','CRON_SECRET'])console.log(k+'=\"'+c.randomBytes(32).toString('base64')+'\"')"
#   ↑ paste those three lines into .env

npm run dev:db     # terminal 1 — MongoDB as a single-node replica set. Leave running.
npm run setup      # terminal 2 — schema + TTL indexes + seed + health check
npm run dev        # terminal 2
```

Then sign in at <http://localhost:3000/login> with the credentials printed by the seed
(`admin@example.com` / `ChangeMeImmediately!2026` by default).

### Email is off until you have a provider

There is no email provider configured yet, so sending is controlled entirely from the
environment — no code change is involved in turning it on.

| Variable | Effect |
|---|---|
| `EMAIL_ENABLED` | Master switch, owned by the deployment. `false` means nothing is sent and no SMTP credentials are required. An admin **cannot** override it from the UI. |
| `EMAIL_CONFIG_SOURCE` | `settings` (default) lets the admin UI win per field; `env` ignores the database `Setting` row entirely. Use `env` until a real provider exists. |
| `EMAIL_PROVIDER` | `console` \| `gmail` \| `smtp` \| `resend` \| `ses` \| `noop` |

With `EMAIL_ENABLED=false`, notifications are **still queued** inside the transaction
that caused them, so nothing is lost — the worker just closes each row out as
`Skipped — email disabled` instead of delivering it. Once a provider exists, flip the
switch and retry the rows from the admin outbox. That is the whole migration.

Locally, leave `EMAIL_ENABLED=true` with `EMAIL_PROVIDER=console`: emails are **printed
to the terminal** rather than sent, so a fresh clone needs no Gmail account and nobody
accidentally emails a real person from seeded data. Invitation and reset links appear as
clickable URLs in the `npm run dev` output.

Production refuses `console` and `noop` while `EMAIL_ENABLED` is true — invitations and
password resets would silently never arrive, and nobody could report it because they
could not log in. Set `EMAIL_ENABLED=false` to opt out deliberately instead.

### MongoDB must be a replica set

Not optional. Prisma's interactive transactions require one, and every write path here
depends on them. Three ways to get one:

| | |
|---|---|
| `npm run dev:db` | downloads a `mongod` binary once, runs a single-node replica set, persists to `.mongo/data`. **Recommended locally.** |
| `docker compose up -d` | if you have Docker |
| MongoDB Atlas | the M0 free tier is already a replica set. Use this for anything deployed. |

`npm run doctor` tells you if this is wrong, along with everything else that is.

---

## Scripts

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run dev:db` | local MongoDB replica set (leave running) |
| `npm run setup` | `db push` → data migrations → seed → doctor |
| `npm run doctor` | pre-flight check: env, connectivity, transactions, seed, invariants, admin |
| `npm run smoke` | end-to-end HTTP check against a running dev server |
| | ⚠️ don't run `build` while `dev` is running — both write `.next`, and the dev server starts 500ing until it recompiles |
| `npm test` | 151 unit + integration tests |
| `npm run typecheck` · `npm run lint` | strict TS, plus the architectural lint rules |
| `npm run build` | production build |
| `npm run db:push` · `db:seed` · `db:migrate-data` · `db:studio` | database |
| `npm run grant:admin -- <email>` | recover a locked-out super-admin |

### Integration tests want their own database

`tests/integration/**` writes real rows, and audit rows are append-only — so pointing them
at a shared or deployed database permanently adds entries to a trail somebody reads. Give
them a separate one in **`.env.test`** (gitignored):

```ini
DATABASE_URL="mongodb://127.0.0.1:27017/deployment_checklist_test?replicaSet=rs0&directConnection=true"
```

`tests/setup.ts` loads `.env.test` **before** `.env`, and `process.loadEnvFile` does not
overwrite a variable that is already set — so this wins and `.env` supplies everything
else. Seed it once with `db push` → `db:migrate-data` → `db:seed` against that URL.

> On Windows, `npm run build` and `npm run setup` fail with *"The token '&&' is not a valid
> statement separator"* — npm runs scripts through PowerShell 5.1, which has no `&&`. Run
> the steps individually, or use Git Bash.

---

## What is built

**Phase 0 — Foundation**, **Phase 1 — Identity**, **Phase 2 — Projects & environments** and
**Phase 4 — The console** are complete and verified. Build order and remaining phases:
[ARCHITECTURE.md](ARCHITECTURE.md#suggested-build-order).

<table>
<tr><td>

**Working**

- Sign in / out, invite → accept, forgot → reset password
- Invite-only: **no sign-up route exists**
- Argon2id hashing, rate limiting, account lockout
- Instant session revocation (`sessionEpoch`)
- Permission engine — roles are data, checks never mention a role
- Navigation generated from permissions
- Append-only audit trail with redaction
- Notification outbox with retries and backoff
- Email provider abstraction
- Tailwind v4 theme from the reference design, dark + light
- Projects and environments CRUD, memberships
- Soft delete **and restore**, through a working trash
- The full deployment lifecycle — start, block, complete, fail, cancel, roll back
- The readiness gate, with GO/HOLD from the completion policy

</td><td valign="top">

**Verified**

- 0 TypeScript errors, 0 lint errors
- 151 tests passing
- 31/31 end-to-end smoke checks
- Production build clean
- Seed is idempotent
- Reference HTML's 10 sections / 49 items seeded as `Production Deployment v1`

</td></tr>
</table>

**Partly built:** the template version editor is done bar version diff (Phase 3).

**Not built yet** (by design — see the build order): editing and deleting comments, the
history grid, dashboard metrics, global search. The dashboard is a placeholder that
deliberately does **not** fake its stat tiles, `/search` returns mock rows until Phase 6
gives it an index, and API keys can be minted but authenticate nothing until a REST door
exists.

### The release gate

A run is created `DRAFT` and driven through the state machine in
[src/domain/deployments/lifecycle.ts](src/domain/deployments/lifecycle.ts):

```
DRAFT ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED ──rollback──▶ ROLLED_BACK
  │                │      ▲                    
  │                │   unblock                 
  │             block  │                        
  │                ▼    │                      
  │              BLOCKED┘                      
  └──cancel──▶ CANCELLED        IN_PROGRESS/BLOCKED ──fail──▶ FAILED
```

Three things worth knowing:

- **GO/HOLD is not a status.** It is computed from the snapshot's `completionPolicy`
  (`ALL_ITEMS` · `ALL_REQUIRED` · `MANUAL`). Under `ALL_REQUIRED` a run reads GO with
  optional items unticked — the gauge says 40%, the gate says go, and both are right.
- **The policy comes from the run's snapshot, never from the template.** Editing a
  template's policy must not move the bar for a release already in flight.
- **`deployment.production` applies to every transition, not just create.** An engineer who
  may complete a staging run cannot seal a production one, with no code change — it comes
  from `isProductionEnvironment` in the authorization scope.

Completing is conditional on the status it was validated against, so two people pressing
Complete at the same moment cannot both win, and only one completion email is queued.

### Deleting is never destroying

Everything tenant-scoped soft-deletes, and `/admin/trash` restores it. Two things that
follow from the schema and are easy to get wrong:

- **A deleted row keeps its unique key.** `@@unique([organizationId, key])` does not
  exclude soft-deleted rows, so identifier probes must see deleted rows or `create` dies
  on the index. Restore therefore always gets its original key back.
- **Restoring a user returns them DEACTIVATED**, never straight to ACTIVE. Their password
  state is unknown at that point; an admin reactivates deliberately.

---

## Layout

```
prisma/schema.prisma        21 collections, every index, annotated
prisma/seed.ts              idempotent; seeds the reference checklist as v1
prisma/migrations-data/     TTL indexes + backfills (prisma migrate has no MongoDB support)
docs/                       01–13 architecture documents
src/app/                    routes only — no business logic
src/features/               vertical slices: auth (+ projects, templates, deployments to come)
src/domain/                 pure business rules; no Prisma, React or Next imports
src/lib/                    authz · audit · notifications · db · http · crypto
src/components/             ui/ (shadcn) + layout composites
scripts/                    dev-db · doctor · smoke · load-env · grant:admin
tests/                      unit (pure) + integration (real database)
```

Where a new file goes: [docs/02 §2.2](docs/02-folder-structure.md#22-where-does-this-file-go).

### Boundaries are enforced, not suggested

`npm run lint` fails on:

- `@prisma/client` imported outside `src/lib/db/**`
- Prisma / React / Next imported inside `src/domain/**`
- any comparison against a role identity (`role === 'admin'`) — authorization must go
  through `can(ctx, PERMISSIONS.x, scope)`

---

## Things that will bite you otherwise

Each of these cost real time during the build and is now handled in code.

**`deletedAt: null` does not match documents where the field is absent.**
Prisma's MongoDB connector reads it as "present *and* null", unlike raw MQL. Since
`DateTime?` has no default, Prisma omits it on insert — so without care, every row ever
created is invisible to every filtered read. Silently. The soft-delete extension now
stamps the field on create, a migration backfills history, and `npm run doctor` verifies
the invariant. [docs/03 §3.7](docs/03-data-model.md#37-working-with-prisma-on-mongodb)

**Auth.js hands `authorize` its own transport fields.** `csrfToken` and `callbackUrl`
arrive alongside the credentials, so a `.strict()` Zod schema rejects the payload and
every sign-in fails with an opaque `CredentialsSignin`. Hence a separate,
non-strict `CredentialsSchema` for that one boundary.

**Credentials provider cannot use database sessions.** That forces JWTs, which conflicts
with instant suspension — resolved with `sessionEpoch` plus two-tier verification.
[docs/04 §4.1](docs/04-authentication.md#41-the-constraint-that-decides-the-session-strategy)

**`next build` sets `NODE_ENV=production`.** Validating production *policy* at build time
fails CI for a correct configuration, because build machines have no production secrets.
Shape is checked at build; policy at runtime boot via `instrumentation.ts`.

**pino `transport` breaks under Next's bundler.** Transports run in a worker thread Next
cannot trace. The logger writes synchronously to stdout; pipe through `pino-pretty` if
you want colour.

**`instrumentation.ts` cannot import Prisma.** Next compiles it as its own entry without
`serverExternalPackages`, so the WASM engine path fails to resolve. Database checks live
in `npm run doctor`.

**A plain index and a TTL index cannot share a key.** MongoDB error 85. `@@index([expiresAt])`
was removed from the three TTL'd models; the migration owns those keys and heals any
conflicting index it finds.

**One `.env`, not `.env.local`.** Prisma's CLI reads only `.env`, Next reads both, and
`tsx` reads neither. `.env` is canonical; `scripts/load-env.ts` gives scripts the same view.

**No cascade deletes.** Prisma emulates referential integrity on MongoDB, so deleting a
`User` with `AuthToken` rows is refused. Deliberate — this system soft-deletes, and
destructive flows go through explicit service routines.
[docs/10 §10.7](docs/10-deployment-lifecycle.md#107-soft-delete-and-restore)

---

## Before production

The full gate is [docs/13 §12](docs/13-recommendations.md#12-production-readiness-gate). The
short version:

- [ ] Fresh `AUTH_SECRET`, `SECRET_ENCRYPTION_KEY`, `CRON_SECRET` per environment
- [ ] MongoDB Atlas with PITR, network allowlist (**not** `0.0.0.0/0`), **restore rehearsed**
- [ ] Least-privilege DB user; `audit_logs` granted insert + find only
- [ ] Real email provider — `console` refuses to boot in production, by design
- [ ] Rotate the seeded admin password; unset `SEED_ALLOW_PRODUCTION`
- [ ] Redis for rate limiting if running more than a couple of instances
- [ ] `npm run doctor` clean against the production database

---

## The design reference

`Pre Deployment checklist.html` is the visual and behavioural reference. What survives:
the dark launch-console aesthetic, the SVG progress ring, numbered collapsible panels, the
GO/HOLD readout, monospace numerics, print-to-PDF, and `prefers-reduced-motion`.

What does not: hardcoded data, `localStorage` persistence, `innerHTML` construction.
Its ten sections are now seeded as a versioned template that admins can edit, and its
`--dim` colour was lightened because at 4.3:1 it failed WCAG AA for the completed-item
text a reviewer most needs to read.
