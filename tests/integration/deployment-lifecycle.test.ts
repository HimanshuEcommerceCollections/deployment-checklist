import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deploymentsService } from '@/features/deployments/server/deployments-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { SEED_ROLES } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * The deployment state machine, end to end at the service layer.
 *
 * Before this, `createDeployment` set DRAFT and nothing in the codebase ever set
 * another status — so `deployment.start`, `.complete` and `.fail` were permissions
 * nothing checked, and a run could be ticked to 100% with no way to close it.
 *
 * Requires a seeded database.
 */
let organizationId: string
let projectId: string
let templateVersionId: string
let stagingId: string
let productionId: string
let adminCtx: RequestContext
let engineerCtx: RequestContext
let qaCtx: RequestContext

const createdRuns: string[] = []

function ctxFor(roleKey: string, actorId: string): RequestContext {
  const role = SEED_ROLES.find((r) => r.key === roleKey)
  if (!role) throw new Error(`No seeded role "${roleKey}"`)

  return {
    actorId,
    actorType: 'user',
    actorEmail: `${roleKey}@example.com`,
    actorName: roleKey,
    organizationId,
    roleKeys: [roleKey],
    permissions: {
      global: new Set<string>(role.permissions),
      byProject: new Map(),
      isSuperAdmin: 'isSuperAdmin' in role ? Boolean(role.isSuperAdmin) : false,
    },
    requestId: `test-${roleKey}`,
    timezone: 'UTC',
  }
}

async function newRun(environmentId = stagingId, label = 'lifecycle') {
  const run = await deploymentsService.createDeployment(adminCtx, {
    projectId,
    templateVersionId,
    environmentId,
    version: `0.0.0-${label}-${createdRuns.length}-${Date.now()}`,
  } as never)
  createdRuns.push(run.id)
  return run
}

/** Tick everything the gate cares about, as the console would. */
async function satisfyGate(runId: string, ctx = adminCtx) {
  const states = await db.checklistItemState.findMany({
    where: { deploymentId: runId, isRequired: true },
    orderBy: { order: 'asc' },
  })

  for (const state of states) {
    await deploymentsService.updateDeploymentItem(ctx, runId, state.itemId, {
      checked: true,
      skipped: false,
      // Evidence-required items refuse a tick without a note.
      note: 'satisfied by the lifecycle test',
    } as never)
  }
}

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ where: { slug: 'default' } })
  organizationId = organization.id

  const project = await db.project.findFirstOrThrow({
    where: { organizationId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  projectId = project.id

  const version = await db.templateVersion.findFirstOrThrow({
    where: { organizationId, status: 'PUBLISHED', deletedAt: null },
    orderBy: { version: 'desc' },
  })
  templateVersionId = version.id

  stagingId = (
    await db.environment.findFirstOrThrow({ where: { organizationId, key: 'staging', deletedAt: null } })
  ).id
  productionId = (
    await db.environment.findFirstOrThrow({
      where: { organizationId, isProduction: true, deletedAt: null },
    })
  ).id

  const admin = await db.user.findFirstOrThrow({ where: { organizationId, deletedAt: null } })
  adminCtx = ctxFor('admin', admin.id)
  engineerCtx = ctxFor('engineer', admin.id)
  qaCtx = ctxFor('qa', admin.id)
})

afterAll(async () => {
  // No cascade deletes on this schema, so children go first.
  await db.checklistItemState.deleteMany({ where: { deploymentId: { in: createdRuns } } })
  await db.deploymentComment.deleteMany({ where: { deploymentId: { in: createdRuns } } })
  await db.deploymentRun.deleteMany({ where: { id: { in: createdRuns } } })
})

describe('the happy path', () => {
  it('goes draft → in progress → completed, recording who and how long', async () => {
    const run = await newRun()
    expect(run.status).toBe('DRAFT')
    expect(run.startedAt).toBeNull()

    const started = await deploymentsService.transition(adminCtx, run.id, 'start')
    expect(started.status).toBe('IN_PROGRESS')
    expect(started.startedAt).not.toBeNull()
    expect(started.startedByName).toBe(adminCtx.actorName)

    await satisfyGate(run.id)

    const completed = await deploymentsService.transition(adminCtx, run.id, 'complete')
    expect(completed.status).toBe('COMPLETED')
    expect(completed.completedAt).not.toBeNull()
    expect(completed.completedByName).toBe(adminCtx.actorName)
    // startedAt → terminal, written once on transition.
    expect(completed.durationMs).not.toBeNull()
    expect(completed.durationMs!).toBeGreaterThanOrEqual(0)
  })

  it('seals the checklist once completed', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')
    await satisfyGate(run.id)
    await deploymentsService.transition(adminCtx, run.id, 'complete')

    const item = await db.checklistItemState.findFirstOrThrow({ where: { deploymentId: run.id } })

    await expect(
      deploymentsService.updateDeploymentItem(adminCtx, run.id, item.itemId, {
        checked: false,
        skipped: false,
      } as never),
    ).rejects.toThrow(/in progress/i)
  })

  it('audits every transition with the from and to statuses', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    const entry = await db.auditLog.findFirst({
      where: { organizationId, action: 'deployment.started', entityId: run.id },
    })

    expect(entry).not.toBeNull()
    expect(entry?.deploymentId).toBe(run.id)
    expect(entry?.metadata).toMatchObject({ from: 'DRAFT', to: 'IN_PROGRESS' })
  })

  it('queues exactly one email per transition, however many retries', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    const queued = await db.notificationOutbox.findMany({
      where: { relatedEntityId: run.id, templateKey: 'deployment-started' },
    })

    // The idempotency key is `run-start:<id>` — a duplicate enqueue is a no-op.
    expect(queued).toHaveLength(1)
    expect(queued[0]?.idempotencyKey).toBe(`run-start:${run.id}`)
  })
})

describe('the readiness gate', () => {
  it('refuses completion while required items are outstanding', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    // Nothing ticked — the seeded template has 32 required items.
    await expect(deploymentsService.transition(adminCtx, run.id, 'complete')).rejects.toThrow(
      /checklist is not complete/i,
    )

    const unchanged = await db.deploymentRun.findUniqueOrThrow({ where: { id: run.id } })
    expect(unchanged.status).toBe('IN_PROGRESS')
    expect(unchanged.completedAt).toBeNull()
  })

  it('carries the outstanding count so the UI can name it', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    try {
      await deploymentsService.transition(adminCtx, run.id, 'complete')
      throw new Error('expected the gate to refuse')
    } catch (error) {
      const details = (error as { details?: { outstanding?: number; policy?: string } }).details
      expect(details?.outstanding).toBeGreaterThan(0)
      expect(details?.policy).toBe('ALL_REQUIRED')
    }
  })

  it('accepts a skipped required item as accounted for', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    const states = await db.checklistItemState.findMany({
      where: { deploymentId: run.id, isRequired: true },
    })

    for (const [index, state] of states.entries()) {
      // Skip one, tick the rest — the gate must count both.
      await deploymentsService.updateDeploymentItem(adminCtx, run.id, state.itemId, {
        checked: index !== 0,
        skipped: index === 0,
        note: 'lifecycle test',
      } as never)
    }

    const completed = await deploymentsService.transition(adminCtx, run.id, 'complete')
    expect(completed.status).toBe('COMPLETED')
  })
})

describe('illegal transitions', () => {
  it('cannot complete a run that was never started', async () => {
    const run = await newRun()

    await expect(deploymentsService.transition(adminCtx, run.id, 'complete')).rejects.toThrow(
      /not a valid next step/i,
    )
  })

  it('cannot start the same run twice', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    await expect(deploymentsService.transition(adminCtx, run.id, 'start')).rejects.toThrow(
      /not a valid next step/i,
    )
  })

  it('cannot roll back a run that never completed', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    await expect(deploymentsService.transition(adminCtx, run.id, 'rollback')).rejects.toThrow(
      /not a valid next step/i,
    )
  })

  it('lets only one of two concurrent completions win', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')
    await satisfyGate(run.id)

    const [first, second] = await Promise.allSettled([
      deploymentsService.transition(adminCtx, run.id, 'complete'),
      deploymentsService.transition(adminCtx, run.id, 'complete'),
    ])

    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(1)

    // And exactly one completion email, not two.
    const queued = await db.notificationOutbox.count({
      where: { relatedEntityId: run.id, templateKey: 'deployment-completed' },
    })
    expect(queued).toBe(1)
  })
})

describe('reasons', () => {
  it('refuses to fail a run without one', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    await expect(deploymentsService.transition(adminCtx, run.id, 'fail')).rejects.toThrow()
    await expect(
      deploymentsService.transition(adminCtx, run.id, 'fail', { reason: '   ' }),
    ).rejects.toThrow()
  })

  it('records the reason on the run and in the audit summary', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    const failed = await deploymentsService.transition(adminCtx, run.id, 'fail', {
      reason: 'Migration timed out against the replica',
    })

    expect(failed.status).toBe('FAILED')
    expect(failed.failureReason).toBe('Migration timed out against the replica')
    expect(failed.durationMs).not.toBeNull()

    const entry = await db.auditLog.findFirst({
      where: { organizationId, action: 'deployment.failed', entityId: run.id },
    })
    expect(entry?.summary).toContain('Migration timed out')
  })

  it('leaves duration null on a run cancelled before it started', async () => {
    const run = await newRun()

    const cancelled = await deploymentsService.transition(adminCtx, run.id, 'cancel', {
      reason: 'Superseded by a later release',
    })

    expect(cancelled.status).toBe('CANCELLED')
    expect(cancelled.cancelReason).toBe('Superseded by a later release')
    // Reporting zero here would drag every average duration down with runs that
    // never ran.
    expect(cancelled.durationMs).toBeNull()
  })
})

describe('blocking', () => {
  it('round-trips through blocked and keeps the checklist writable', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    const blocked = await deploymentsService.transition(adminCtx, run.id, 'block', {
      reason: 'Waiting on the DBA',
    })
    expect(blocked.status).toBe('BLOCKED')

    // A blocker does not stop the work — items stay editable.
    const item = await db.checklistItemState.findFirstOrThrow({
      where: { deploymentId: run.id },
      orderBy: { order: 'asc' },
    })
    await deploymentsService.updateDeploymentItem(adminCtx, run.id, item.itemId, {
      checked: true,
      skipped: false,
      note: 'still working',
    } as never)

    const unblocked = await deploymentsService.transition(adminCtx, run.id, 'unblock')
    expect(unblocked.status).toBe('IN_PROGRESS')
  })

  it('does not email the project about a blocker', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')
    await deploymentsService.transition(adminCtx, run.id, 'block', { reason: 'Waiting on infra' })

    const queued = await db.notificationOutbox.count({
      where: { relatedEntityId: run.id, templateKey: { startsWith: 'deployment-' } },
    })

    // Only the start email. Mailing every blocker toggle trains people to ignore
    // the ones that matter.
    expect(queued).toBe(1)
  })
})

describe('permissions', () => {
  it('refuses a role without deployment.start', async () => {
    const run = await newRun()

    // QA holds read and execute — they tick items, they do not run releases.
    expect(qaCtx.permissions.global.has('deployment.start')).toBe(false)
    await expect(deploymentsService.transition(qaCtx, run.id, 'start')).rejects.toThrow()
  })

  it('refuses a role without deployment.rollback', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')
    await satisfyGate(run.id)
    await deploymentsService.transition(adminCtx, run.id, 'complete')

    expect(engineerCtx.permissions.global.has('deployment.rollback')).toBe(false)
    await expect(deploymentsService.transition(engineerCtx, run.id, 'rollback')).rejects.toThrow()
  })

  it('applies the production escalation to every transition, not just create', async () => {
    // Engineer may complete a staging run...
    const staging = await newRun(stagingId, 'eng-staging')
    await deploymentsService.transition(engineerCtx, staging.id, 'start')
    await satisfyGate(staging.id, engineerCtx)
    expect((await deploymentsService.transition(engineerCtx, staging.id, 'complete')).status).toBe(
      'COMPLETED',
    )

    // ...and the same actor may not touch a production one, because
    // isProductionEnvironment adds deployment.production on top of the verb.
    const production = await newRun(productionId, 'eng-prod')
    expect(engineerCtx.permissions.global.has('deployment.production')).toBe(false)
    await expect(deploymentsService.transition(engineerCtx, production.id, 'start')).rejects.toThrow()
  })

  it('reports why a transition is unavailable rather than hiding it', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')

    const fresh = await db.deploymentRun.findUniqueOrThrow({ where: { id: run.id } })
    const options = deploymentsService.availableTransitions(adminCtx, fresh)

    const complete = options.find((o) => o.name === 'complete')
    expect(complete?.available).toBe(false)
    expect(complete?.unavailable).toMatch(/outstanding/)

    // Block is legal from IN_PROGRESS and the admin holds execute.
    expect(options.find((o) => o.name === 'block')?.available).toBe(true)
  })

  it('offers nothing on a sealed run except rollback', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')
    await satisfyGate(run.id)
    await deploymentsService.transition(adminCtx, run.id, 'complete')

    const fresh = await db.deploymentRun.findUniqueOrThrow({ where: { id: run.id } })
    const options = deploymentsService.availableTransitions(adminCtx, fresh)

    expect(options.map((o) => o.name)).toEqual(['rollback'])
  })
})

describe('rollback', () => {
  it('records a rollback without overwriting the release duration', async () => {
    const run = await newRun()
    await deploymentsService.transition(adminCtx, run.id, 'start')
    await satisfyGate(run.id)
    const completed = await deploymentsService.transition(adminCtx, run.id, 'complete')

    const rolledBack = await deploymentsService.transition(adminCtx, run.id, 'rollback', {
      reason: 'Checkout error rate tripled',
    })

    expect(rolledBack.status).toBe('ROLLED_BACK')
    expect(rolledBack.rollbackReason).toBe('Checkout error rate tripled')
    // durationMs describes the release, not the rollback.
    expect(rolledBack.durationMs).toBe(completed.durationMs)
    expect(rolledBack.completedAt).toEqual(completed.completedAt)
  })
})
