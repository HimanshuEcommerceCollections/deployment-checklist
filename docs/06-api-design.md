# 6 — API Design

## 6.1 Two transports, one service layer

| | Server Actions | REST `/api/v1` |
|---|---|---|
| Callers | our own UI | CI/CD, exports, integrations, future mobile |
| Auth | session cookie | session cookie or API key |
| Typing | end-to-end TypeScript | OpenAPI + generated client |
| Versioned | no (ships with the UI) | yes (`/v1`) |
| Progressive enhancement | works without JS | n/a |

Both are **thin adapters**. Neither contains a business rule, a permission decision, an audit write, or a Prisma query.

```
Server Action ─┐
               ├─▶  Service method  ─▶  domain rules · repository · audit · outbox
REST handler  ─┘
```

A Server Action longer than about twenty lines is holding logic that belongs in a service. The test: if `POST /api/v1/deployments/:id/transitions` and the `completeDeployment` action could ever behave differently, the logic is in the wrong place.

---

## 6.2 Server Actions

```ts
// src/features/deployments/actions/checklist.actions.ts
'use server'

export async function toggleChecklistItem(
  input: ToggleItemInput,
): Promise<ActionResult<{ readiness: Readiness; completedItems: number }>> {
  try {
    const ctx = await getRequestContext()
    const data = ToggleItemSchema.parse(input)

    const result = await deploymentService.toggleItem(ctx, data)

    revalidateTag(CacheTags.deployment(data.runId))
    // Notifications and event fan-out run after the response is flushed, so a
    // slow SMTP handshake never shows up as checkbox latency.
    after(() => events.publish('deployment.readiness.changed', { runId: data.runId }))

    return ok(result)
  } catch (error) {
    return toActionResult(error)   // one mapper, used by every action
  }
}
```

### Result shape

Actions never throw across the boundary — an uncaught error in a Server Action becomes an opaque digest in production, which is useless to both the user and the developer.

```ts
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; message: string;
      fieldErrors?: Record<string, string[]>; details?: unknown }
```

`toActionResult` maps domain errors to codes: `ZodError` → `VALIDATION_ERROR` with `fieldErrors` (which React Hook Form applies directly to inputs), `ForbiddenError` → `FORBIDDEN`, `NotFoundError` → `NOT_FOUND`, `ConflictError` → `CONFLICT` with the fresh server state so an optimistic UI can reconcile, `PreconditionFailedError` → `PRECONDITION_FAILED` with the outstanding items. Anything unrecognised is logged with the `requestId` and returned as a generic `INTERNAL_ERROR` — internal messages never reach the client.

### Cache invalidation

Tags are centralised so no route guesses a string:

```ts
// src/lib/cache/tags.ts
export const CacheTags = {
  deployment: (id: string) => `deployment:${id}`,
  deploymentList: (projectId?: string) => projectId ? `deployments:${projectId}` : 'deployments',
  project: (id: string) => `project:${id}`,
  template: (id: string) => `template:${id}`,
  settings: (orgId: string) => `settings:${orgId}`,
  roles: (orgId: string) => `roles:${orgId}`,
  dashboard: (orgId: string) => `dashboard:${orgId}`,
} as const
```

A completion revalidates `deployment:<id>`, `deployments:<projectId>`, `deployments`, and `dashboard:<orgId>`. A settings change revalidates `settings:<orgId>` — which is why an SMTP change takes effect on the next request rather than the next deploy.

---

## 6.3 REST

### One wrapper for every route

```ts
// src/app/api/v1/deployments/route.ts
export const GET = withApi({
  permission: PERMISSIONS.deployment.read,
  query: ListDeploymentsQuery,
  rateLimit: { key: 'api:read', limit: 300, windowMs: 60_000 },
  handler: async ({ ctx, query }) => {
    const page = await deploymentService.list(ctx, query)
    return paginated(page)
  },
})

export const POST = withApi({
  permission: PERMISSIONS.deployment.create,
  body: CreateDeploymentSchema,
  rateLimit: { key: 'api:write', limit: 60, windowMs: 60_000 },
  idempotent: true,                       // honours the Idempotency-Key header
  handler: async ({ ctx, body }) => {
    const run = await deploymentService.create(ctx, body)
    return created(run, `/api/v1/deployments/${run.id}`)
  },
})
```

`withApi` does, in order: assign a `requestId` → verify `Origin` on unsafe methods → resolve the request context → rate limit → check the declared permission (a route with no `permission` must set `public: true` explicitly, so omission fails closed) → validate params/query/body with Zod → enter the tenant `AsyncLocalStorage` scope → run the handler → serialise → map errors → emit a structured access log.

Declaring the permission in the route config rather than inside the handler means a static test can assert that every route under `/api/v1` declares one.

### Conventions

| Aspect | Choice |
|---|---|
| Base | `/api/v1` |
| Casing | `camelCase` JSON (matches TypeScript; no mapping layer) |
| Dates | ISO-8601 UTC with `Z` |
| Ids | 24-char hex ObjectId strings |
| Success | `{ data, meta? }` |
| Error | `{ error: { code, message, details?, fieldErrors?, requestId } }` |
| Deletes | `DELETE` = soft delete (`204`). Hard delete is `DELETE ?purge=true` and needs an extra permission |
| Transitions | `POST /:id/transitions` with `{ action, reason? }`, not `PATCH { status }` |

Transitions are their own endpoint on purpose. `PATCH { status: "COMPLETED" }` invites clients to think status is a writable field; it is the *outcome* of an action with guards and side effects. `POST /transitions { action: "complete" }` says so.

### Pagination

Two strategies, chosen per endpoint by data shape:

**Offset** — admin tables where "page 7 of 23" matters:

```
GET /api/v1/projects?page=2&pageSize=25
{ "data": [...], "meta": { "page": 2, "pageSize": 25, "total": 143, "totalPages": 6 } }
```

**Cursor** — high-volume, append-heavy lists (audit logs, timelines, comments):

```
GET /api/v1/audit-logs?limit=50&cursor=eyJpZCI6IjY1Zi4uLiJ9
{ "data": [...], "meta": { "nextCursor": "eyJpZCI6IjY1Zi4uLiJ9", "hasMore": true } }
```

Offset pagination degrades on large collections — `skip: 50000` makes MongoDB walk 50,000 documents — and it double-counts or skips rows when the underlying data shifts between pages, which for an append-heavy audit log is constant. Cursors are opaque base64 of the last sort key plus `_id` as a tiebreaker, so they are stable and index-friendly.

`pageSize` is clamped to 100 (`limit` to 200 for cursor endpoints). Exports stream instead of paginating.

### Filtering, sorting, search

```
GET /api/v1/deployments
      ?status=IN_PROGRESS,BLOCKED          multi-value = OR
      &projectId=6501…
      &environmentKey=production
      &startedById=6502…
      &from=2026-01-01&to=2026-06-30       inclusive range on createdAt
      &q=hotfix                            search
      &sort=-createdAt,version             leading "-" = descending
      &page=1&pageSize=25
```

Sort keys are validated against a **per-endpoint allowlist**, never passed through:

```ts
const SORTABLE = ['createdAt', 'completedAt', 'version', 'status', 'durationMs'] as const

export function parseSort(raw: string | undefined, allowed: readonly string[], fallback: object) {
  if (!raw) return fallback
  const orderBy = raw.split(',').map((token) => {
    const desc = token.startsWith('-')
    const field = desc ? token.slice(1) : token
    if (!allowed.includes(field)) throw new ValidationError(`Cannot sort by "${field}"`)
    return { [field]: desc ? 'desc' : 'asc' }
  })
  return orderBy.length ? orderBy : fallback
}
```

Unvalidated sort fields are both an injection surface and a performance hazard — an unindexed sort on a large collection is a collection scan.

### Endpoint catalogue

```
Auth
  POST   /api/auth/callback/credentials         Auth.js
  POST   /api/auth/signout
Server Actions handle invite acceptance, forgot, reset (all form-driven)

Projects
  GET    /api/v1/projects                        list · filter · sort · page
  POST   /api/v1/projects                        project.create
  GET    /api/v1/projects/:id
  PATCH  /api/v1/projects/:id                    project.edit
  DELETE /api/v1/projects/:id                    soft delete
  POST   /api/v1/projects/:id/restore
  GET    /api/v1/projects/:id/templates
  PUT    /api/v1/projects/:id/templates          replace the enabled set
  GET    /api/v1/projects/:id/members
  POST   /api/v1/projects/:id/members            grant a project role
  DELETE /api/v1/projects/:id/members/:userId

Templates
  GET    /api/v1/templates
  POST   /api/v1/templates
  GET    /api/v1/templates/:id
  PATCH  /api/v1/templates/:id
  DELETE /api/v1/templates/:id
  POST   /api/v1/templates/:id/duplicate         → new template, content cloned
  GET    /api/v1/templates/:id/versions
  POST   /api/v1/templates/:id/versions          new DRAFT (optionally from a version)
  GET    /api/v1/templates/:id/versions/:version
  PATCH  /api/v1/templates/:id/versions/:version DRAFT only
  POST   /api/v1/templates/:id/versions/:version/publish
  POST   /api/v1/templates/:id/versions/:version/deprecate
  GET    /api/v1/templates/:id/versions/:version/diff?against=N
  PUT    …/sections/reorder                      { orderedSectionIds }
  PUT    …/sections/:sid/items/reorder            { orderedItemIds }
  POST   …/sections            PATCH/DELETE …/sections/:sid   (+ /restore)
  POST   …/sections/:sid/items PATCH/DELETE …/items/:iid       (+ /restore)

Deployments
  GET    /api/v1/deployments                     the history endpoint
  POST   /api/v1/deployments                     creates the snapshot
  GET    /api/v1/deployments/:id
  PATCH  /api/v1/deployments/:id                 DRAFT / IN_PROGRESS only
  DELETE /api/v1/deployments/:id
  POST   /api/v1/deployments/:id/restore
  POST   /api/v1/deployments/:id/transitions     { action, reason? }
  GET    /api/v1/deployments/:id/items
  PATCH  /api/v1/deployments/:id/items/:itemId   { checked | skipped | note, revision }
  POST   /api/v1/deployments/:id/items/bulk      { itemIds[], checked }   ← "check all in section"
  GET    /api/v1/deployments/:id/comments        cursor
  POST   /api/v1/deployments/:id/comments
  PATCH  /api/v1/deployments/:id/comments/:cid
  DELETE /api/v1/deployments/:id/comments/:cid
  GET    /api/v1/deployments/:id/timeline        audit-derived
  GET    /api/v1/deployments/export?format=csv|xlsx&…   streamed

Users & access
  GET    /api/v1/users            POST /api/v1/users/:id/suspend | /restore
  PATCH  /api/v1/users/:id        DELETE /api/v1/users/:id
  GET    /api/v1/invitations      POST /api/v1/invitations
  POST   /api/v1/invitations/:id/resend | /revoke
  GET    /api/v1/roles            POST /api/v1/roles
  PATCH  /api/v1/roles/:id        DELETE /api/v1/roles/:id
  GET    /api/v1/permissions      catalog, grouped — powers the role editor

Config & ops
  GET    /api/v1/environments     POST · PATCH · DELETE
  GET    /api/v1/settings         PATCH /api/v1/settings      secrets masked
  POST   /api/v1/settings/email/test        sends a test message
  GET    /api/v1/audit-logs                 cursor · filters
  GET    /api/v1/audit-logs/export
  GET    /api/v1/notifications/outbox        POST …/:id/retry
  GET    /api/v1/dashboard/stats
  GET    /api/v1/search?q=&types=projects,deployments,templates,users

Ops
  GET    /api/health                          liveness — no DB
  GET    /api/ready                           readiness — pings DB
  POST   /api/cron/{outbox,rollup,sweep,reap}  CRON_SECRET
```

### Status codes

`200` ok · `201` created (with `Location`) · `202` accepted (queued) · `204` no content · `400` malformed · `401` unauthenticated · `403` authenticated but not permitted · `404` missing *or hidden* · `409` conflict (stale `revision`, duplicate key) · `412` precondition failed (checklist gate, illegal transition) · `422` validation failed with `fieldErrors` · `429` rate limited (with `Retry-After`) · `500` internal (message suppressed, `requestId` returned).

`404` is used for resources the actor may not see, rather than `403`. Returning `403` for an existing resource confirms its existence to someone who has no right to know — a resource-enumeration oracle.

`409` vs `412` matters for the client: `409` means *your copy is stale, here is the current state* and the UI reconciles silently; `412` means *the operation is not currently valid* and the UI explains why.

### Errors

```json
{
  "error": {
    "code": "PRECONDITION_FAILED",
    "message": "3 required checklist items are outstanding.",
    "details": {
      "reason": "CHECKLIST_INCOMPLETE",
      "outstanding": [
        { "section": "Testing",  "label": "Manual QA sign-off on critical user flows" },
        { "section": "Security", "label": "Dependency vulnerability scan run" },
        { "section": "Final Go / No-Go", "label": "Go decision confirmed by team lead" }
      ]
    },
    "requestId": "req_01JQ8F3K2M"
  }
}
```

Machine-readable `code`, human-readable `message`, structured `details` the UI can render, and a `requestId` that appears in the log line, the audit entry, and the Sentry event. A user can paste it into a ticket and an engineer can find everything about that request.

### Idempotency

`POST` routes marked `idempotent: true` honour an `Idempotency-Key` header: the first request stores its response keyed by `(actorId, route, key)` for 24 hours, and a repeat returns the stored response. A CI pipeline retrying `POST /deployments` after a network timeout must not create two runs, and CI pipelines retry constantly.

### Rate limiting

Fixed-window counters, Redis when configured, otherwise the `RateLimit` collection with a TTL index. **In-process counters are not an option** — serverless runs many instances, and each would enforce the limit independently.

| Bucket | Limit |
|---|---|
| `login:<email>` | 10 / 15 min |
| `login:ip:<ip>` | 30 / 15 min |
| `forgot:<email>` | 5 / hour |
| `forgot:ip:<ip>` | 20 / hour |
| `invite:<actorId>` | 20 / hour |
| `api:read:<actorId>` | 300 / min |
| `api:write:<actorId>` | 60 / min |
| `export:<actorId>` | 5 / hour |
| `upload:<actorId>` | 30 / hour |

Auth buckets are checked **before** any database work, so a credential-stuffing run costs an index lookup rather than an Argon2 verification. Responses include `X-RateLimit-Limit`, `-Remaining`, `-Reset` and, on 429, `Retry-After`.

### Validation

One Zod schema per operation, shared between the form, the action, and the REST route. Three rules:

```ts
export const CreateDeploymentSchema = z.object({
  projectId: objectId(),
  templateId: objectId(),
  environmentId: objectId(),
  version: z.string().trim().min(1).max(50)
    .regex(/^[\w.\-+]+$/, 'Letters, numbers, dots, hyphens and plus only'),
  title: z.string().trim().max(200).optional(),
  releaseNotes: z.string().max(20_000).optional(),
  scheduledAt: z.coerce.date().optional(),
}).strict()   // ← unknown keys REJECTED, not stripped
```

- `.strict()` everywhere. Stripping unknown keys silently accepts `{ status: "COMPLETED" }`; rejecting surfaces the client bug. This is the mass-assignment defence.
- Every string is `.trim()`-ed and length-capped. An uncapped markdown field is a denial-of-service vector.
- Ids validated as ObjectId shape (`/^[0-9a-fA-F]{24}$/`) before reaching Prisma, which throws an ugly internal error on malformed ids.

Cross-field and cross-entity rules (does this template belong to this project? is this environment enabled here?) live in the **service**, not the schema. Zod validates shape; services validate meaning.

---

## 6.4 Contract and observability

**OpenAPI** generated from the Zod schemas with `zod-to-openapi`, served at `/api/v1/openapi.json` with Scalar docs at `/api/v1/docs`. Generated, not hand-written, so it cannot drift. A CI check fails the build if the committed spec differs from the generated one — that diff is also the review surface for accidental breaking changes.

**Structured access logs** — one line per request: `requestId`, `actorId`, method, route pattern (not the raw path, so ids do not explode log cardinality), status, duration, `orgId`. `requestId` also lands on every `AuditLog` row written during that request, so an audit entry links to its access log and its Sentry event.

**Versioning policy.** `/v1` is additive-only: new optional fields and new endpoints are fine; removing a field, tightening validation, or changing a status code requires `/v2`. Server Actions are unversioned because they ship with the UI that calls them — a meaningful advantage, and the reason the UI does not consume its own REST API.
