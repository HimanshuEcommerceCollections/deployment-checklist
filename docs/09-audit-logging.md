# 9 — Audit Logging

The requirement is *"every action should be logged, full audit trail"*. For a release-control tool that is not a nice-to-have — it is the artifact people point at when a deployment goes wrong at 3am and someone asks who ticked *Backup taken* without taking a backup.

---

## 9.1 Design principles

**Append-only, enforced at the database.** No code path updates or deletes an `AuditLog` row. Application-level immutability is a promise; the runtime database user is granted `insert` and `find` on `audit_logs` and nothing else, which is a guarantee. A Prisma Client extension throws on any `update`/`delete`/`upsert` against the model, so the mistake is caught in development before it reaches the grant that would refuse it in production.

**Written by the service layer, not by middleware.** A Prisma extension can see that `deployment_runs` changed; it cannot know that this was a *completion*, who decided it, or why. Meaningful audit needs intent, and intent only exists where the use case is expressed. A `$allOperations` extension runs as a **safety net** in development only: it warns when a tracked model is written during a request that produced no audit entry, which catches the write that forgot to record itself.

**Actor identity is frozen, not referenced.** `actorEmail`, `actorName`, and `actorRoles` are copied onto every row. If someone is renamed, changes role, or is deleted, historical entries must still read as they did when written. These are **never** backfilled — an audit log that updates itself when a user is renamed is not an audit log.

**Structured diffs, not prose.** `changes: [{ field, from, to }]` is queryable, diffable, and renderable. A `summary` string is stored alongside it for the activity feed, but the structured form is the record.

**Never blocks the user.** Audit writes that must be atomic with their state change go in the transaction. High-volume, low-stakes entries (item toggles) are written through `after()`, post-response.

**Redaction at the boundary.** The differ strips sensitive fields before anything is persisted. An audit log containing an old SMTP password is a credential leak with a compliance story attached.

---

## 9.2 What gets logged

Action codes are `resource.action` strings, catalogued in [src/lib/audit/actions.ts](../src/lib/audit/actions.ts). `AuditLog.action` is a **`String`, not an enum**, so a new domain event never requires a schema change — the same reasoning as the permission catalog.

```
auth.        login_succeeded · login_failed · login_locked · login_inactive
             logout · rate_limited · password_reset_requested
             password_reset_completed · password_changed · session_revoked

user.        invited · invite_accepted · invite_resent · invite_revoked
             created · updated · role_changed · suspended · reactivated
             deleted · restored · profile_updated

role.        created · updated · permissions_changed · deleted · restored

project.     created · updated · status_changed · deleted · restored
             member_added · member_role_changed · member_removed
             templates_changed

template.    created · updated · duplicated · deleted · restored
             version_created · version_updated · version_published
             version_deprecated
             section_created · section_updated · section_deleted
             section_restored · sections_reordered
             item_created · item_updated · item_deleted
             item_restored · items_reordered

deployment.  created · updated · started · completed · failed
             cancelled · rolled_back · deleted · restored · exported
             item.checked · item.unchecked · item.skipped · item.unskipped
             item.note_added · item.evidence_overridden
             comment_added · comment_edited · comment_deleted
             attachment_added · attachment_deleted

environment. created · updated · deleted · restored
settings.    updated · email_provider_changed · storage_provider_changed
             smtp_credentials_changed · email_test_sent
notification.dead_lettered · retried
system.      migration_applied · seed_run · job_failed
```

Mapped against the brief's examples, all covered: user checked item → `deployment.item.checked`; unchecked → `deployment.item.unchecked`; started/completed/cancelled → `deployment.*`; template updated → `template.version_updated` and `template.version_published`; project edited → `project.updated`; user invited → `user.invited`.

### Record shape

```json
{
  "action": "deployment.item.checked",
  "actorId": "6501f…", "actorEmail": "priya@company.com", "actorName": "Priya K.",
  "actorRoles": ["developer", "qa"], "actorType": "user",
  "entityType": "ChecklistItemState", "entityId": "6509a…",
  "entityLabel": "Manual QA sign-off on critical user flows",
  "organizationId": "64f0…", "projectId": "6502…", "deploymentId": "6508…",
  "changes": [{ "field": "checked", "from": false, "to": true }],
  "metadata": { "sectionTitle": "Testing", "isRequired": true,
                "readinessAfter": "HOLD", "outstandingAfter": 2 },
  "summary": "Priya K. checked \"Manual QA sign-off on critical user flows\" in Testing",
  "ip": "203.0.113.44",
  "userAgent": "Mozilla/5.0 (Macintosh…) Chrome/126",
  "requestId": "req_01JQ8F3K2M", "correlationId": "req_01JQ8F3K2M",
  "createdAt": "2026-07-27T09:14:22.481Z"
}
```

`metadata.readinessAfter` is worth the extra field: it turns the log from a list of ticks into a reconstruction of *when the release became ready*, which is the question people actually ask afterwards.

---

## 9.3 Implementation

```ts
// src/lib/audit/audit-service.ts
export class AuditService implements AuditRecorder {
  constructor(private readonly db: PrismaClient, private readonly clock: Clock) {}

  /**
   * Atomic path: pass the transaction client. Used when the audit entry must
   * exist if and only if the state change committed.
   */
  async record(tx: TxClient, ctx: RequestContext, action: AuditAction, input: AuditInput) {
    const changes = input.before !== undefined
      ? redactChanges(diff(input.before, input.after, input.trackedFields))
      : input.changes

    // Nothing changed → nothing to record. Without this, every no-op form save
    // adds a row and the trail becomes unreadable noise.
    if (changes && changes.length === 0 && !ALWAYS_LOG.has(action)) return

    await tx.auditLog.create({
      data: {
        action,
        organizationId: ctx.organizationId,
        actorId: ctx.actorType === 'user' ? ctx.actorId : null,
        actorEmail: ctx.actorEmail,
        actorName: ctx.actorName,
        actorRoles: [...ctx.roleKeys],      // frozen — never backfilled
        actorType: ctx.actorType,
        entityType: input.entityType,
        entityId: input.entityId,
        entityLabel: input.entityLabel?.slice(0, 200),
        projectId: input.projectId, deploymentId: input.deploymentId,
        templateId: input.templateId, targetUserId: input.targetUserId,
        changes: changes ?? undefined,
        metadata: input.metadata ? redactObject(input.metadata) : undefined,
        summary: input.summary ?? renderSummary(action, ctx, input),
        ip: ctx.ip, userAgent: ctx.userAgent?.slice(0, 400),
        requestId: ctx.requestId, correlationId: ctx.requestId,
        createdAt: this.clock.now(),
      },
    })
  }

  /**
   * Deferred path: for high-volume, non-atomic entries. Called from `after()`,
   * so it runs post-response.
   *
   * A failure here must NEVER surface to the user — the state change already
   * committed. It is logged at error level and picked up by alerting.
   */
  async recordDeferred(ctx: RequestContext, action: AuditAction, input: AuditInput) {
    try {
      await this.record(this.db, ctx, action, input)
    } catch (error) {
      logger.error({ err: error, action, requestId: ctx.requestId }, 'audit write failed')
    }
  }
}
```

### Diffing

```ts
// src/domain/audit/diff.ts — pure
export function diff<T extends Record<string, unknown>>(
  before: T, after: Partial<T>, trackedFields?: readonly (keyof T)[],
): AuditChange[] {
  const fields = trackedFields ?? (Object.keys(after) as (keyof T)[])
  const changes: AuditChange[] = []

  for (const field of fields) {
    if (!(field in after)) continue
    const from = before[field]
    const to = after[field]
    // Deep compare: arrays (roleIds, permissions, environmentKeys) are ordinary
    // fields here, and a shallow compare would report a change on every save.
    if (!deepEqual(from, to)) {
      changes.push({ field: String(field), from: normalise(from), to: normalise(to) })
    }
  }
  return changes
}
```

`trackedFields` exists so `updatedAt`, `updatedById`, `searchText`, and other bookkeeping fields never appear as changes. Without it every edit records four meaningless diffs and the signal drowns.

### Redaction

```ts
// src/domain/audit/redact.ts
const SENSITIVE = [
  /password/i, /secret/i, /token/i, /apikey/i, /api_key/i,
  /credential/i, /smtp.*(pass|secret)/i, /privatekey/i, /session/i, /cipher/i,
]

export function redactChanges(changes: AuditChange[]): AuditChange[] {
  return changes.map((c) =>
    SENSITIVE.some((p) => p.test(c.field))
      // Record THAT it changed, never the values. "smtpSecretRef changed" is
      // the audit fact; the old password is a liability.
      ? { field: c.field, from: '«redacted»', to: '«redacted»' }
      : truncateLongValues(c),
  )
}
```

Values over 2 KB are truncated with a `«truncated»` marker. A 20,000-character release-notes edit stored twice per revision would bloat the fastest-growing collection in the system for no forensic gain.

---

## 9.4 Writing patterns

### Atomic — state and audit commit together

```ts
await db.$transaction(async (tx) => {
  const updated = await tx.deploymentRun.update({ where: { id }, data: { status: 'COMPLETED', … } })
  await audit.record(tx, ctx, 'deployment.completed', {
    entityType: 'DeploymentRun', entityId: id, entityLabel: run.reference,
    projectId: run.projectId, deploymentId: id,
    before: { status: run.status }, after: { status: 'COMPLETED' },
    metadata: { durationMs: updated.durationMs, completedItems: run.completedItems,
                totalItems: run.totalItems, environmentKey: run.environmentKey },
  })
  await notifications.enqueue({ … }, tx)
})
```

Used for every state transition, permission change, and settings change — anything where a state change without its audit entry would be a compliance failure.

### Deferred — post-response

```ts
const result = await deploymentService.toggleItem(ctx, input)
revalidateTag(CacheTags.deployment(runId))

after(() =>
  audit.recordDeferred(ctx, result.checked ? 'deployment.item.checked' : 'deployment.item.unchecked', {
    entityType: 'ChecklistItemState', entityId: result.stateId, entityLabel: result.label,
    projectId: result.projectId, deploymentId: runId,
    changes: [{ field: 'checked', from: !result.checked, to: result.checked }],
    metadata: { sectionTitle: result.sectionTitle, isRequired: result.isRequired,
                readinessAfter: result.readiness.state },
  }),
)
```

Item toggles are the highest-volume audited action — a hundred-plus per deployment, often in bursts when someone works through a section. Deferring keeps the checkbox instant. The trade-off is honest: a process crash between response and `after()` loses one toggle entry. Acceptable for a tick; not acceptable for a completion, which is why completions are atomic.

### Bulk

"Check all in section" writes **one** entry with the item list in `metadata`, not fifteen rows:

```ts
await audit.record(tx, ctx, 'deployment.items_bulk_checked', {
  entityType: 'DeploymentRun', entityId: runId, deploymentId: runId,
  metadata: { sectionTitle, count: items.length,
              items: items.map((i) => ({ id: i.itemId, label: i.label })),
              readinessAfter: readiness.state },
  summary: `${ctx.actorName} checked all ${items.length} items in ${sectionTitle}`,
})
```

Fifteen near-identical rows make the timeline unreadable. One row with a count and an expandable list is what a reviewer wants.

### Reorder

```ts
metadata: { from: previousOrder.map(labelOf), to: nextOrder.map(labelOf) }
```

Recording positional indices (`order: 3 → 1`) is technically accurate and completely unreadable six months later. Labels are what make the entry useful.

---

## 9.5 Reading

### Deployment timeline

The audit log is not just compliance storage — it is a **product feature**. The timeline tab on every run is a projection over `(deploymentId, createdAt)`:

```
09:02  Priya K.    started this deployment                          v2.14.0 → staging
09:04  Priya K.    checked 6 items in Code & Review
09:11  Arun M.     checked "Unit tests pass (CI green)"
09:12  Arun M.     commented — "Flaky test on the payments suite, rerunning"
09:18  Arun M.     checked "Integration tests pass"
09:26  Sam O.      attached qa-report.pdf to "Manual QA sign-off"
09:26  Sam O.      checked "Manual QA sign-off on critical user flows"
09:31  Priya K.    skipped "Migrations tested on a staging copy" — no schema change
09:40  Priya K.    checked all 4 items in Final Go / No-Go        → readiness GO
09:41  Ravi T.     completed this deployment                          duration 39m
```

One index (`deploymentId, createdAt`), one query, no joins — actor names are already denormalised on the rows. It is the cheapest high-value screen in the application.

### Audit viewer

`/admin/audit` — `audit.read` required. Cursor pagination (never offset: `skip: 200000` on the largest collection in the system is a scan). Filters: actor, action, entity type, project, deployment, date range, IP. Expandable rows showing the structured diff. Export to CSV/JSONL, streamed, capped at 100k rows per export, and itself audited as `audit.exported` — exporting the audit log is an auditable act.

### Entity history

Every detail page shows "Recent activity" from `(entityType, entityId, createdAt)`. On a template version this is the answer to *"who changed this checklist and when?"* — the question the snapshot design exists to make answerable.

---

## 9.6 Growth, retention, and integrity

At roughly 20,000 deployments over three years with ~120 items each, `audit_logs` is the fastest-growing collection in the system — around 8 million documents, dominated by item toggles.

| Threshold | Action |
|---|---|
| < 5 M docs | current design, no change |
| 5–50 M | archive to cold storage nightly when `auditRetentionDays > 0`; keep a 12-month hot window |
| > 50 M | convert to a MongoDB time-series collection (managed outside Prisma) or move to a purpose-built store |

`Setting.auditRetentionDays` defaults to **0 = keep forever**, deliberately. A TTL index that quietly deletes audit history is a compliance incident waiting to happen; retention must be an explicit, audited decision. When enabled, rows are exported to storage as JSONL before deletion, and the export itself is logged.

**Integrity, if you need it.** Not built by default, and it should not be: hash chaining costs a serialised write per entry and only pays off under an adversarial threat model. If you later need tamper-evidence — SOC 2, or an untrusted admin — add `previousHash` and `hash = sha256(previousHash + canonicalJson(entry))` per organisation, with a verifier job. The schema has room; the decision is deliberately deferred rather than paid for speculatively.

**Backup.** `audit_logs` is included in Atlas continuous backup with PITR. It is the one collection where a restore that loses the last hour is a genuine problem, so it is explicitly named in the restore drill.

---

## 9.7 Testing

```ts
it('records a diff, not the whole entity, on project update', async () => {
  await projectService.update(ctx, project.id, { name: 'Apex Core', color: '#35d68f' })

  const entry = await lastAudit('project.updated')
  expect(entry.changes).toEqual([
    { field: 'name',  from: 'Apex', to: 'Apex Core' },
    { field: 'color', from: '#4fc7e8', to: '#35d68f' },
  ])
  expect(entry.actorEmail).toBe(ctx.actorEmail)   // frozen actor identity
})

it('never records a secret value', async () => {
  await settingsService.update(ctx, { smtpSecretRef: 'new-app-password' })

  const entry = await lastAudit('settings.smtp_credentials_changed')
  expect(JSON.stringify(entry)).not.toContain('new-app-password')
  expect(entry.changes).toEqual([{ field: 'smtpSecretRef', from: '«redacted»', to: '«redacted»' }])
})

it('writes no row when nothing changed', async () => {
  const before = await countAudits()
  await projectService.update(ctx, project.id, { name: project.name })   // same value
  expect(await countAudits()).toBe(before)
})

it('refuses to mutate an audit row', async () => {
  await expect(db.auditLog.update({ where: { id }, data: { action: 'x' } })).rejects.toThrow(/append-only/)
  await expect(db.auditLog.delete({ where: { id } })).rejects.toThrow(/append-only/)
})

it('rolls the audit entry back with its transaction', async () => {
  vi.spyOn(notifications, 'enqueue').mockRejectedValueOnce(new Error('boom'))
  await expect(deploymentService.completeRun(ctx, runId)).rejects.toThrow()

  expect(await findAudit('deployment.completed', runId)).toBeNull()
  expect((await getRun(runId)).status).toBe('IN_PROGRESS')   // neither happened
})
```

The last test is the one that proves the transactional design rather than just describing it: a failure anywhere in the transaction leaves neither the state change nor the audit entry. That property is the whole reason `record()` takes a transaction client instead of using the global one.

A conformance test also asserts that **every mutating service method produces at least one audit entry** — it walks the exported methods, calls each with a fixture, and fails on a silent write. "Every action should be logged" is a requirement that decays the moment a new endpoint forgets, so it is checked mechanically rather than by review.
