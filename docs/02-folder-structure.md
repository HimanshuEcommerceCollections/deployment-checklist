# 2 — Folder Structure

## 2.1 Full tree

```
deployment-checklist/
├── .env.example
├── .env.local                              # gitignored
├── docker-compose.yml                      # mongo as a single-node REPLICA SET (required)
├── eslint.config.js                        # boundary rules — see docs/01 §1.2
├── next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
├── components.json                         # shadcn/ui config
├── ARCHITECTURE.md
│
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                             # roles, permissions, admin, envs, HTML template as v1
│   ├── seeds/
│   │   ├── permissions.seed.ts             # mirrors src/lib/authz/permissions.ts
│   │   ├── roles.seed.ts                   # Admin, Developer (+ QA/DevOps/RM as examples)
│   │   ├── environments.seed.ts            # development, qa, uat, staging, production
│   │   └── production-deployment.seed.ts   # the 10 sections from the attached HTML
│   ├── migrations-data/                    # prisma migrate is unavailable on MongoDB
│   │   ├── 0001-create-ttl-indexes.ts      # TTL on auth_tokens, rate_limits, job_locks
│   │   ├── 0002-atlas-search-index.ts
│   │   ├── 0003-backfill-search-text.ts
│   │   └── runner.ts                       # ledger + lock + checksum
│   └── indexes.md                          # every index, with the query it serves
│
├── docs/
│   ├── 01-system-architecture.md … 13-recommendations.md
│   └── adr/
│       ├── 0001-embedded-checklist-snapshot.md
│       ├── 0002-jwt-sessions-with-session-epoch.md
│       ├── 0003-server-actions-plus-rest.md
│       ├── 0004-permission-catalog-in-code.md
│       └── 0005-organization-id-from-day-one.md
│
├── public/
│
├── emails/                                 # React Email templates (previewable)
│   ├── components/{layout,button,footer}.tsx
│   ├── user-invite.tsx
│   ├── password-reset.tsx
│   ├── deployment-completed.tsx
│   ├── deployment-failed.tsx
│   └── template-updated.tsx
│
├── tests/
│   ├── unit/                               # domain: state machine, readiness, permissions
│   ├── integration/                        # services against mongodb-memory-server (repl set)
│   ├── e2e/                                # Playwright: invite→accept→deploy→complete
│   └── fixtures/
│
└── src/
    ├── middleware.ts                       # Edge: JWT presence + signature ONLY
    │
    ├── app/                                #  ── ROUTES ONLY. No business logic. ──
    │   ├── layout.tsx                      # html shell, ThemeProvider, fonts
    │   ├── globals.css                     # Tailwind v4 @theme tokens (from the HTML)
    │   ├── error.tsx  not-found.tsx
    │   │
    │   ├── (auth)/                         # unauthenticated, centred card layout
    │   │   ├── layout.tsx
    │   │   ├── login/page.tsx
    │   │   ├── forgot-password/page.tsx
    │   │   ├── reset-password/[token]/page.tsx
    │   │   └── accept-invite/[token]/page.tsx
    │   │
    │   ├── (app)/                          # authenticated shell: sidebar + topbar
    │   │   ├── layout.tsx                  # getRequestContext() once, provides to tree
    │   │   ├── dashboard/page.tsx
    │   │   ├── projects/
    │   │   │   ├── page.tsx
    │   │   │   └── [projectSlug]/
    │   │   │       ├── page.tsx            # project overview
    │   │   │       └── deployments/
    │   │   │           ├── new/page.tsx    # project → template → env → version
    │   │   │           └── [reference]/
    │   │   │               ├── page.tsx    # ★ THE CONSOLE (the attached HTML, rebuilt)
    │   │   │               ├── timeline/page.tsx
    │   │   │               └── loading.tsx
    │   │   ├── deployments/page.tsx        # history: search, filter, sort, paginate, export
    │   │   ├── search/page.tsx             # global search results
    │   │   └── account/{profile,password,preferences}/page.tsx
    │   │
    │   ├── (admin)/admin/                  # gated by admin.access in the layout
    │   │   ├── layout.tsx
    │   │   ├── page.tsx
    │   │   ├── projects/…                  # list, new, [id]/edit
    │   │   ├── templates/
    │   │   │   ├── page.tsx
    │   │   │   └── [id]/
    │   │   │       ├── page.tsx            # version list + publish
    │   │   │       ├── versions/[version]/edit/page.tsx   # ★ section/item editor + DnD
    │   │   │       └── versions/[version]/diff/page.tsx
    │   │   ├── users/…                      # list, invite, [id]
    │   │   ├── roles/…                      # list, new, [id]  ← permission matrix
    │   │   ├── environments/page.tsx
    │   │   ├── audit/page.tsx
    │   │   ├── settings/{general,email,security,branding}/page.tsx
    │   │   └── trash/page.tsx               # soft-delete restore across all entities
    │   │
    │   └── api/
    │       ├── auth/[...nextauth]/route.ts
    │       ├── v1/
    │       │   ├── projects/route.ts                    ·  [id]/route.ts
    │       │   ├── templates/route.ts                   ·  [id]/versions/route.ts
    │       │   ├── deployments/route.ts                 ·  [id]/route.ts
    │       │   ├── deployments/[id]/items/[itemId]/route.ts
    │       │   ├── deployments/[id]/transitions/route.ts
    │       │   ├── deployments/[id]/comments/route.ts
    │       │   ├── deployments/export/route.ts          # CSV/XLSX stream
    │       │   ├── users/route.ts  ·  invitations/route.ts
    │       │   ├── audit-logs/route.ts
    │       │   └── search/route.ts
    │       ├── cron/{outbox,rollup,sweep,reap}/route.ts # CRON_SECRET guarded
    │       └── health/route.ts  ·  ready/route.ts
    │
    ├── features/                           #  ── VERTICAL SLICES ──
    │   ├── auth/
    │   │   ├── server/{auth-service.ts,invitation-service.ts,password-service.ts}
    │   │   ├── schemas/{login.schema.ts,invite.schema.ts,reset.schema.ts}
    │   │   ├── actions/{login.action.ts,accept-invite.action.ts,reset.action.ts}
    │   │   └── components/{login-form.tsx,accept-invite-form.tsx,password-strength.tsx}
    │   │
    │   ├── projects/
    │   │   ├── server/{project-service.ts,project-repository.ts}
    │   │   ├── schemas/project.schema.ts
    │   │   ├── actions/project.actions.ts
    │   │   ├── components/{project-form.tsx,project-card.tsx,project-switcher.tsx,project-table.tsx}
    │   │   └── queries/{get-projects.ts,get-project-detail.ts}
    │   │
    │   ├── templates/
    │   │   ├── server/{template-service.ts,version-service.ts,template-repository.ts}
    │   │   ├── schemas/{template.schema.ts,section.schema.ts,item.schema.ts,reorder.schema.ts}
    │   │   ├── actions/{template.actions.ts,section.actions.ts,item.actions.ts}
    │   │   └── components/
    │   │       ├── template-editor.tsx          # client: DnD orchestration
    │   │       ├── section-editor-card.tsx
    │   │       ├── item-editor-row.tsx
    │   │       ├── sortable-list.tsx            # dnd-kit wrapper, reused for both
    │   │       ├── publish-dialog.tsx
    │   │       └── version-diff.tsx
    │   │
    │   ├── deployments/
    │   │   ├── server/
    │   │   │   ├── deployment-service.ts        # create · transition · toggleItem
    │   │   │   ├── snapshot-builder.ts          # ★ TemplateVersion → ChecklistSnapshot
    │   │   │   ├── deployment-repository.ts
    │   │   │   └── deployment-export.ts
    │   │   ├── schemas/{create-run.schema.ts,toggle-item.schema.ts,transition.schema.ts}
    │   │   ├── actions/{deployment.actions.ts,checklist.actions.ts}
    │   │   ├── queries/{get-run-detail.ts,list-runs.ts,get-history.ts}
    │   │   ├── hooks/{use-checklist.ts,use-deployment-channel.ts}
    │   │   └── components/
    │   │       ├── deployment-console.tsx       # ★ orchestrator (client)
    │   │       ├── launch-gauge.tsx             # ★ the SVG ring from the HTML
    │   │       ├── readiness-badge.tsx          # GO / HOLD / BLOCKED
    │   │       ├── checklist-section-panel.tsx  # the collapsible panel
    │   │       ├── checklist-item-row.tsx       # ★ optimistic toggle
    │   │       ├── item-evidence-popover.tsx
    │   │       ├── deployment-header.tsx
    │   │       ├── status-actions.tsx           # start/complete/fail/cancel/rollback
    │   │       ├── new-deployment-wizard.tsx
    │   │       └── history-table.tsx
    │   │
    │   ├── comments/     {server,schemas,actions,components}/
    │   ├── users/        {server,schemas,actions,components}/
    │   ├── roles/        {server,schemas,actions,components}/   # permission matrix UI
    │   ├── environments/ {server,schemas,actions,components}/
    │   ├── settings/     {server,schemas,actions,components}/
    │   ├── audit/        {server,queries,components}/
    │   ├── dashboard/    {server,queries,components}/
    │   └── search/       {server,queries,components}/
    │
    ├── domain/                             #  ── PURE. NO IMPORTS FROM prisma/react/next ──
    │   ├── deployments/{state-machine.ts,readiness.ts,progress.ts,reference.ts,errors.ts}
    │   ├── templates/{version-rules.ts,reorder.ts,tree.ts}
    │   ├── authz/{evaluate.ts,wildcard.ts}
    │   ├── shared/{result.ts,value-objects.ts,pagination.ts,errors.ts}
    │   └── audit/{diff.ts,redact.ts}
    │
    ├── lib/                                #  ── CROSS-CUTTING INFRASTRUCTURE ──
    │   ├── db/{prisma.ts,tenant-extension.ts,soft-delete-extension.ts,transaction.ts}
    │   ├── auth/{auth.config.ts,auth.ts,session.ts,password.ts,tokens.ts}
    │   ├── authz/{permissions.ts,authorize.ts,context.ts,can.tsx}
    │   ├── audit/{actions.ts,audit-service.ts,differ.ts,request-meta.ts}
    │   ├── notifications/
    │   │   ├── types.ts                    # NotificationChannel, EmailProvider, …
    │   │   ├── dispatcher.ts
    │   │   ├── outbox.ts
    │   │   ├── registry.ts                 # factory: settings/env → provider
    │   │   ├── channels/{email-channel.ts,slack-channel.ts,webhook-channel.ts}
    │   │   ├── providers/{gmail.ts,smtp.ts,resend.ts,ses.ts,console.ts,noop.ts}
    │   │   └── renderer.ts                 # React Email → { html, text }
    │   ├── events/{bus.ts,events.ts,handlers/*.ts}
    │   ├── http/{api-handler.ts,responses.ts,errors.ts,pagination.ts,query-parser.ts,rate-limit.ts}
    │   ├── crypto/{secret-box.ts,hash.ts,random.ts}
    │   ├── cache/{tags.ts,cached.ts}
    │   ├── markdown/{render.ts,sanitize.ts}
    │   ├── config/{env.ts,settings.ts,constants.ts}
    │   ├── logger/{logger.ts,redact.ts}
    │   └── utils/{cn.ts,date.ts,format.ts,csv.ts,nanoid.ts}
    │
    ├── components/
    │   ├── ui/                             # shadcn/ui primitives (generated; edit freely)
    │   ├── layout/{app-shell.tsx,sidebar.tsx,topbar.tsx,breadcrumbs.tsx,user-menu.tsx,theme-toggle.tsx}
    │   ├── data/{data-table.tsx,column-header.tsx,pagination-bar.tsx,filter-bar.tsx,
    │   │        empty-state.tsx,export-button.tsx,search-input.tsx}
    │   ├── feedback/{confirm-dialog.tsx,error-state.tsx,loading-skeletons.tsx,toaster.tsx}
    │   ├── forms/{form-field.tsx,submit-button.tsx,markdown-editor.tsx,color-picker.tsx,
    │   │         file-dropzone.tsx,combobox-field.tsx}
    │   └── primitives/{progress-ring.tsx,progress-bar.tsx,status-pill.tsx,
    │                  relative-time.tsx,user-avatar.tsx,copy-button.tsx}
    │
    ├── server/
    │   ├── container.ts                    # wires ports → adapters (the only `new XProvider()`)
    │   ├── context.ts                      # getRequestContext(), React cache()
    │   ├── als.ts                          # AsyncLocalStorage: orgId, userId, requestId
    │   └── jobs/{outbox-drain.ts,stats-rollup.ts,sweep.ts,reap.ts,with-job-lock.ts}
    │
    ├── types/{index.ts,next-auth.d.ts,api.ts}
    └── config/{navigation.ts,statuses.ts,theme.ts}
```

## 2.2 Where does this file go?

The table people actually need on day three.

| I am writing… | Put it in | Not in |
|---|---|---|
| A rule with no I/O (can this transition happen?) | `src/domain/<area>/` | a service, an action |
| A DB query for one page | `src/features/<f>/queries/` | `app/**/page.tsx` |
| A business transaction (create, transition, toggle) | `src/features/<f>/server/*-service.ts` | an action, a route handler |
| A Zod schema | `src/features/<f>/schemas/` | inline in the component |
| A Server Action | `src/features/<f>/actions/` | the component file |
| A REST endpoint | `src/app/api/v1/…/route.ts`, calling the service | with logic inside |
| A component used by one feature | `src/features/<f>/components/` | `src/components/` |
| A component used by 3+ features | `src/components/{data,forms,primitives}/` | duplicated |
| A shadcn primitive | `src/components/ui/` (generated) | hand-written |
| Anything importing `@prisma/client` | `src/lib/db/`, `src/infrastructure/`, `*-repository.ts` | anywhere else |
| A provider adapter (Resend, SES) | `src/lib/<port>/providers/` | a service |
| An index change | `prisma/schema.prisma` **and** `prisma/indexes.md` | schema only |
| A data backfill | `prisma/migrations-data/NNNN-*.ts` | a one-off script you run by hand |

## 2.3 Conventions

**Naming.** Files `kebab-case.ts`. React components `PascalCase` in `kebab-case.tsx`. Services `noun-service.ts`, repositories `noun-repository.ts`, schemas `noun.schema.ts`, actions `noun.actions.ts`. Server-only modules start with `import 'server-only'`.

**Imports.** `@/` → `src/`. Feature-to-feature imports go through the feature's public surface only (`features/x/server/index.ts`), never into another feature's internals — one more boundary rule.

**Route groups.** `(auth)` unauthenticated · `(app)` authenticated shell · `(admin)` permission-gated at the layout. Parentheses mean no URL segment, so `(app)/dashboard` is `/dashboard`.

**Colocation.** `loading.tsx`, `error.tsx`, and `page.tsx` live together. A component used by exactly one page can live beside it until a second consumer appears — then it moves up. Do not pre-promote.

**Barrels.** One `index.ts` per feature's public surface. No barrels inside `components/` — they defeat tree-shaking and create import cycles.

## 2.4 The three files worth reading first

`src/server/container.ts` — the only place concrete providers are constructed. Reading it tells you every external dependency the system has:

```ts
import 'server-only'

export const container = {
  db: prisma,
  email: createEmailProvider(env.EMAIL_PROVIDER),            // gmail | smtp | resend | ses | console
  notifications: createDispatcher([emailChannel /*, slackChannel */]),
  rateLimiter: env.REDIS_URL ? new RedisRateLimiter() : new MongoRateLimiter(prisma),
  clock: systemClock,
  ids: nanoIdGenerator,
  logger,
} satisfies Container
```

`src/lib/authz/permissions.ts` — the complete permission vocabulary. The answer to "what can this system do?".

`src/features/deployments/server/snapshot-builder.ts` — the function that makes deployment history immutable. If you change one thing here you change the guarantee the product is built on.
