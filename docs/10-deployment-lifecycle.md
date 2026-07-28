# 10 — Deployment Lifecycle

## 10.1 States

```
                        ┌───────────────────────────────────────┐
      create ──────────▶│               DRAFT                   │  snapshot taken HERE
                        │  editable · checklist frozen already  │
                        └───┬───────────────────────────┬───────┘
                     start  │                    cancel │
                        ┌───▼───────────┐               │
              unblock ─▶│  IN_PROGRESS  │───── cancel ──┤
             ┌──────────│  ticking      │               │
             │          └───┬───────┬───┘               │
             │        block │       │ fail              │
       ┌─────┴─────┐        │   ┌───▼────┐       ┌──────▼──────┐
       │  BLOCKED  │◀───────┘   │ FAILED │       │  CANCELLED  │
       │  waiting  │            └───┬────┘       └─────────────┘
       └───────────┘                │ rollback
                                    │
        completion gate ────┐  ┌────▼─────────┐
                     ┌──────▼──▼──┐           │
                     │  COMPLETED │──rollback▶│  ROLLED_BACK  │
                     └────────────┘           └───────────────┘
                        terminal                   terminal
```

### Two additions to the brief

**`FAILED`.** Your notification list includes *Deployment Failed*, but the status list stopped at Draft / In Progress / Completed / Cancelled. Without `FAILED` there is nowhere to record "we shipped and it broke", and the failure email has no state to fire from. `CANCELLED` is the wrong home for it: cancelling means the release never went out; failing means it went out and went wrong. Conflating them makes the failure-rate metric meaningless.

**`ROLLED_BACK`.** Rollback workflows are on your future list, but the state and the `rollbackOfId` self-relation cost nothing now and retrofitting a terminal state later means backfilling history. Reachable from both `COMPLETED` and `FAILED` — you can roll back a deployment that "succeeded" and then broke in production, which is the common case.

**`BLOCKED`** is also new, and optional in practice. It records "waiting on something external" — a vendor, an approval, a fix — without abandoning the run. Without it, teams cancel and recreate, which loses the checklist progress and the comment thread.

### GO / HOLD is not a status

The reference HTML's readout is a **computed readiness gate**, not persisted state:

```ts
type Readiness =
  | { state: 'GO';      outstanding: []; reason: string }
  | { state: 'HOLD';    outstanding: SnapshotItem[]; reason: string }
  | { state: 'BLOCKED'; outstanding: SnapshotItem[]; reason: string }
```

A run can be `IN_PROGRESS` and `GO` — that is precisely the interesting moment, when the checklist is satisfied and someone with `deployment.complete` may act. Persisting readiness would create two sources of truth that drift; deriving it from the snapshot and item states means it cannot.

| `completionPolicy` | Gate |
|---|---|
| `ALL_ITEMS` | every non-skipped item checked |
| `ALL_REQUIRED` | every non-skipped `isRequired` item checked *(default)* |
| `MANUAL` | no gate; permission alone decides |

Set per template version, captured in the snapshot, so changing the policy on a template does not retroactively re-gate a run in flight.

---

## 10.2 Transition table

Declarative. The single source of truth for what is possible.

```ts
// src/domain/deployments/state-machine.ts — pure, no I/O
export const TRANSITIONS: readonly Transition[] = [
  { action: 'start',    from: ['DRAFT'],                  to: 'IN_PROGRESS',
    permission: 'deployment.start' },

  { action: 'block',    from: ['IN_PROGRESS'],             to: 'BLOCKED',
    permission: 'deployment.edit',      requiresReason: true },

  { action: 'unblock',  from: ['BLOCKED'],                 to: 'IN_PROGRESS',
    permission: 'deployment.edit' },

  { action: 'complete', from: ['IN_PROGRESS'],             to: 'COMPLETED',
    permission: 'deployment.complete',  guard: 'checklistGate' },

  { action: 'fail',     from: ['IN_PROGRESS', 'BLOCKED'],  to: 'FAILED',
    permission: 'deployment.fail',      requiresReason: true },

  { action: 'cancel',   from: ['DRAFT', 'IN_PROGRESS', 'BLOCKED'], to: 'CANCELLED',
    permission: 'deployment.cancel',    requiresReason: true },

  { action: 'rollback', from: ['COMPLETED', 'FAILED'],     to: 'ROLLED_BACK',
    permission: 'deployment.rollback',  requiresReason: true },
]

export function availableTransitions(status: DeploymentStatus): Transition[] {
  return TRANSITIONS.filter((t) => t.from.includes(status))
}
```

The UI's action buttons are **generated** from `availableTransitions(run.status)` intersected with the actor's permissions. There is no second list of buttons to keep in sync, and an illegal transition cannot be offered.

Terminal states — `COMPLETED`, `CANCELLED`, `ROLLED_BACK` — accept no further transitions except the rollback edge. `FAILED` is terminal for the checklist but allows rollback. Once terminal, items cannot be ticked and the run is read-only for everyone regardless of permission: history that can be edited after the fact is not history. Fixing a mistake means a new run, which is honest and leaves both records.

---

## 10.3 Creating a run

```
POST /api/v1/deployments   |   createDeployment action
 │
 1. requirePermission(deployment.create, { projectId, isProductionEnvironment })
 │      production adds an implicit deployment.production requirement
 2. Zod: projectId · templateId · environmentId · version · title? · notes? · scheduledAt?
 3. Cross-entity validation — the part Zod cannot do:
 │      project exists, not soft-deleted, status ≠ ARCHIVED
 │      environment is active AND enabled for this project
 │      template is linked to this project via ProjectTemplate
 │      the link's environmentKeys permit this environment
 │      template has a PUBLISHED current version   ← cannot deploy a draft
 4. Warn (do not block) if the same version already shipped to this environment
 │      redeploying a version is legitimate; silently allowing it is not
 5. $transaction:
 │      a. sequence  = Project.deploymentCount + 1        atomic $inc
 │         reference = `${project.key}-${sequence}`       e.g. APEX-142
 │      b. { snapshot, states } = buildSnapshot(version, environmentKey, ids, now)
 │      c. DeploymentRun.create({ status: DRAFT, checklist: snapshot,
 │                                totalItems, totalRequired,
 │                                completedItems: 0, completedRequired: 0,
 │                                environmentKey, environmentName, isProduction })
 │      d. ChecklistItemState.createMany(states)          all unchecked
 │      e. Project.update({ deploymentCount: +1, lastDeploymentAt, lastDeploymentEnv })
 │      f. audit('deployment.created', { templateVersion, itemCount, environmentKey })
 6. redirect /projects/<slug>/deployments/<reference>
```

**The snapshot is taken at creation, not at start.** Deliberate: a run may sit in `DRAFT` for days while a release is scheduled, and the checklist someone reviewed when they created the run must be the checklist they execute. Snapshotting at `start` would let an admin publish a new template version in between and silently change the agreed scope.

`sequence` and `reference` come from an atomic `$inc` on `Project.deploymentCount`, so concurrent creations cannot collide, and `(projectId, sequence)` is uniquely indexed as a second line of defence.

---

## 10.4 Executing

```ts
async toggleItem(ctx: RequestContext, input: ToggleItemInput) {
  const run = await this.repo.findForExecution(input.runId)
  if (!run) throw new NotFoundError('DeploymentRun', input.runId)

  requirePermission(ctx, PERMISSIONS.deployment.execute, { projectId: run.projectId })

  const state = await this.repo.findItemState(input.runId, input.itemId)
  if (!state) throw new NotFoundError('ChecklistItemState', input.itemId)

  // ── Domain policies, separate from authorization ────────────────────────
  if (run.status !== 'IN_PROGRESS')
    throw new PreconditionFailedError('RUN_NOT_IN_PROGRESS')

  if (!input.checked) {
    const policy = canUncheckItem({
      actorId: ctx.actorId, state, runStatus: run.status,
      hasUncheckOther: can(ctx, PERMISSIONS.deployment.itemUncheckOther, { projectId: run.projectId }),
    })
    if (!policy.allowed) throw new PreconditionFailedError(policy.code, policy)
  }

  const item = findSnapshotItem(run.checklist, input.itemId)
  if (input.checked && item.evidenceRequired && !state.note && state.attachmentIds.length === 0) {
    if (!can(ctx, PERMISSIONS.deployment.itemOverride, { projectId: run.projectId }))
      throw new PreconditionFailedError('EVIDENCE_REQUIRED', { itemLabel: item.label })
  }

  // Already in the requested state → no-op. Makes the operation idempotent, so
  // a double-click or a retried request does not corrupt the counters.
  if (state.checked === input.checked) return this.currentState(run, state)

  return db.$transaction(async (tx) => {
    // Conditional update IS the concurrency control. count === 0 means someone
    // else moved first — no locks, no read-modify-write race.
    const { count } = await tx.checklistItemState.updateMany({
      where: { deploymentId: input.runId, itemId: input.itemId, revision: input.revision },
      data: {
        checked: input.checked,
        checkedAt: input.checked ? this.clock.now() : null,
        checkedById: input.checked ? ctx.actorId : null,
        checkedByName: input.checked ? ctx.actorName : null,
        revision: { increment: 1 },
        toggleCount: { increment: 1 },
      },
    })

    if (count === 0) {
      const fresh = await tx.checklistItemState.findUnique({
        where: { deploymentId_itemId: { deploymentId: input.runId, itemId: input.itemId } },
      })
      // 409 carries the authoritative state so the optimistic UI reconciles
      // silently instead of showing an error for a normal race.
      throw new ConflictError('STALE_REVISION', { current: fresh })
    }

    const delta = input.checked ? 1 : -1
    const updated = await tx.deploymentRun.update({
      where: { id: input.runId },
      data: {
        completedItems: { increment: delta },
        completedRequired: { increment: state.isRequired ? delta : 0 },
        updatedById: ctx.actorId,
      },
      select: RUN_PROGRESS_SELECT,
    })

    return { ...this.project(updated), readiness: await this.readinessFor(tx, run) }
  })
}
```

Three properties worth naming, because each removes a class of bug:

- **Idempotent.** Toggling to the state it is already in is a no-op, so a double-click or a retried request cannot double-count.
- **Conflict-detecting.** The `revision` predicate makes the conditional update itself the concurrency control — no locks, no read-modify-write window.
- **Counter-consistent.** Counters move in the same transaction as the state, so `completedItems` cannot drift from reality. (The nightly reconcile verifies this and logs drift as a warning rather than trusting it silently.)

### Skipping

`skipped` marks an item not applicable to *this* run — "Migrations tested on a staging copy" on a release with no schema change. Skipped items are excluded from the gate and do not count toward `completedItems`. Requires `deployment.item.skip`, requires a reason, and is audited. The alternative — ticking an item that was not actually done — corrupts the record and destroys trust in the checklist, which is the entire product.

---

## 10.5 Completing

```ts
async completeRun(ctx: RequestContext, runId: string, input: { note?: string }) {
  const run = await this.repo.findForTransition(runId)
  if (!run) throw new NotFoundError('DeploymentRun', runId)

  requirePermission(ctx, PERMISSIONS.deployment.complete, {
    projectId: run.projectId, isProductionEnvironment: run.isProduction,
  })

  assertTransitionAllowed(run.status, 'complete')          // state machine

  const states = await this.repo.listItemStates(runId)
  const readiness = evaluateReadiness({
    snapshot: run.checklist, states: toMap(states), policy: run.checklist.completionPolicy,
  })

  if (readiness.state !== 'GO') {
    // The outstanding items travel with the error so the UI can name them.
    throw new PreconditionFailedError('CHECKLIST_INCOMPLETE', {
      outstanding: readiness.outstanding.map((i) => ({
        section: sectionTitleFor(run.checklist, i.id), label: i.label,
      })),
    })
  }

  const now = this.clock.now()
  // startedAt, not createdAt — a run may sit in DRAFT for days, and counting
  // that as deployment duration makes every metric meaningless.
  const durationMs = run.startedAt ? now.getTime() - run.startedAt.getTime() : null

  return db.$transaction(async (tx) => {
    const updated = await tx.deploymentRun.update({
      where: { id: runId, status: run.status },      // optimistic guard on status
      data: { status: 'COMPLETED', completedAt: now, completedById: ctx.actorId,
              completedByName: ctx.actorName, durationMs, updatedById: ctx.actorId },
    })

    await audit.record(tx, ctx, 'deployment.completed', { … })
    await notifications.enqueue({
      templateKey: 'deployment-completed', idempotencyKey: `run-complete:${runId}`,
      recipients: await this.subscribersFor(run), payload: toEmailPayload(updated),
    }, tx)
    await this.stats.recordCompletion(tx, updated)     // DeploymentDailyStat
    return updated
  })
}
```

The `where: { id, status: run.status }` guard closes the last race: two people clicking *Complete* simultaneously both pass the gate, but only one update matches, and the loser gets a conflict rather than a duplicate notification.

### Side effects by transition

| Transition | Effects |
|---|---|
| `start` | `startedAt`, `startedById`, `startedByName` · audit · `deployment-started` (opt-in) · items become tickable |
| `block` | `blockReason` in metadata · audit · items stay tickable |
| `complete` | timestamps · `durationMs` · audit · `deployment-completed` · daily stat · project `lastDeploymentAt` · dashboard cache invalidated |
| `fail` | `failedAt`, `failureReason` · audit · `deployment-failed` (**high priority**) · daily stat |
| `cancel` | `cancelledAt`, `cancelReason` · audit · `deployment-cancelled` to the starter · **no** stat (never shipped) |
| `rollback` | `rolledBackAt`, `rollbackReason` · audit · notification · optionally creates a new run with `rollbackOfId` set |

Cancelled runs are excluded from the daily stats on purpose: including abandoned drafts in a failure rate produces a number nobody trusts and everybody argues about.

---

## 10.6 Template versioning against live runs

The interaction the snapshot exists for:

```
Mon 09:00  Template "Production Deployment" v1 PUBLISHED — 49 items
Mon 10:00  Priya creates APEX-142  ─┐
                                    ├─ snapshot of v1 embedded in the run
Mon 10:05  Priya starts APEX-142  ──┘
Mon 11:00  Ravi edits the template → a DRAFT v2 is cloned; v1 untouched
Mon 11:30  Ravi publishes v2 — adds 3 items, removes 1, reorders Security
             template.currentVersionId → v2
             APEX-142 STILL SHOWS 49 ITEMS FROM v1.       ← the guarantee
Mon 14:00  Sam creates APEX-143  ─── snapshot of v2, 51 items
Tue 09:00  Priya completes APEX-142 against the v1 checklist she agreed to
```

APEX-142 never reads `TemplateVersion`. Not "is careful not to" — has no code path that could.

### Publishing

```
1. requirePermission(template.publish)
2. assert version.status === 'DRAFT'
3. assert at least one live section with at least one live item
     an empty published template silently produces empty checklists
4. $transaction:
     a. version.update { status: PUBLISHED, publishedAt, publishedById,
                         sectionCount, itemCount, requiredCount }
     b. previous current version → DEPRECATED  (still readable; still referenced
                                                by runs; just not offered to new ones)
     c. template.update { currentVersionId, currentVersion }
     d. audit('template.version_published', { diff vs previous })
     e. enqueue 'template-updated' to users with template.read on affected projects (opt-in)
5. revalidateTag(template:<id>)
```

Editing a `PUBLISHED` version is refused. The UI offers **Clone to draft**, which copies content into a new `DRAFT` with `clonedFromVersionId` set, powering the version diff view. Item and section `id`s are **preserved** across the clone, so `sourceItemId` lineage survives and "how often has *Sonar Passed* blocked releases?" spans versions.

---

## 10.7 Soft delete and restore

Restore is a first-class flow, not an afterthought. `/admin/trash` shows soft-deleted projects, templates, versions, sections, items, users, and runs, with who deleted them and when.

| Entity | Deleting it | Restore |
|---|---|---|
| Project | hidden from lists; **existing runs keep working** | restores project only |
| Template | not offered for new runs; existing runs unaffected | restores template |
| Template version | not offered for new runs; existing runs unaffected | restores version |
| Section / item | excluded from **future** snapshots; existing snapshots unchanged | restores into the version |
| User | sign-in blocked, `sessionEpoch` bumped; their comments, ticks, and audit entries all remain attributed | reactivates; requires a password reset |
| Deployment run | hidden from history; **audit entries remain** | restores run |

The rule throughout: **soft delete never rewrites history.** Deleting a checklist item does not remove it from a completed run's snapshot, because that run genuinely had that item and someone genuinely ticked it. Deleting a user does not anonymise their audit entries, because the record of who did what is the point.

No cascade deletes. Deleting a project soft-deletes the project; its runs remain intact and accessible by direct link. Cascading would destroy release history as a side effect of tidying a project list — and Prisma's emulated cascades on MongoDB would issue unbounded queries to do it.

Hard delete exists for GDPR-style erasure only: a separate `purge` operation behind its own permission, which anonymises actor fields to `"Deleted user"` while **retaining the audit rows themselves**. That balances the right to erasure against the integrity of a release record, and the purge is itself audited.

---

## 10.8 Edge cases

| Situation | Behaviour |
|---|---|
| Template deleted while a run is in progress | run continues; the snapshot is self-contained |
| Environment deleted mid-run | run continues; `environmentKey`/`environmentName` are denormalised on the row |
| Project archived mid-run | existing runs finishable; no new runs |
| User deactivated mid-run | their ticks stand and stay attributed; they cannot make new ones |
| Two people complete simultaneously | `where: { id, status }` guard — one wins, the other gets `409` |
| Two people tick the same item | `revision` guard — one wins, the other reconciles silently |
| Two people tick different items | both succeed; no conflict by design |
| Client sends a stale `revision` | `409` with the current state; optimistic UI adopts it |
| All items skipped | gate passes (`outstanding` is empty). Audited, and visibly flagged on the run |
| Template published with zero items | refused at publish |
| Run in `DRAFT` for months | fine; the snapshot is fixed and `durationMs` measures from `startedAt` |
| Same version deployed twice to production | allowed, with a warning. Redeploys and hotfix reissues are legitimate |
| Rollback of a rollback | allowed; `rollbackOfId` chains |
| Clock skew across instances | all timestamps come from the `Clock` port on the server, never the client |
| Deployment spans midnight UTC | daily stats bucket by UTC day of the terminal transition; the UI renders in `Setting.timezone` |
