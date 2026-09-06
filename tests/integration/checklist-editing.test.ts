import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { deploymentsService } from '@/features/deployments/server/deployments-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { SEED_ROLES } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * Checklist tailoring on DRAFT runs — the snapshot is the run's own copy, so
 * edits must keep three things in lockstep: the snapshot content, the
 * ChecklistItemState rows, and the counters the completion gate reads.
 *
 * Requires a seeded database (run `npm run dev:db`, then setup, first).
 */
let organizationId: string
let projectId: string
let templateVersionId: string
let stagingId: string
let adminCtx: RequestContext
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

async function newDraft() {
  const run = await deploymentsService.createDeployment(adminCtx, {
    projectId,
    templateVersionId,
    environmentId: stagingId,
    version: `0.0.0-tailor-${createdRuns.length}-${Date.now()}`,
  } as never)
  createdRuns.push(run.id)
  return run
}

async function reload(runId: string) {
  return db.deploymentRun.findFirstOrThrow({ where: { id: runId } })
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
    await db.environment.findFirstOrThrow({
      where: { organizationId, key: 'staging', deletedAt: null },
    })
  ).id

  const admin = await db.user.findFirstOrThrow({ where: { organizationId, deletedAt: null } })
  adminCtx = ctxFor('admin', admin.id)
  qaCtx = ctxFor('qa', admin.id)
})

afterAll(async () => {
  await db.checklistItemState.deleteMany({ where: { deploymentId: { in: createdRuns } } })
  await db.deploymentRun.deleteMany({ where: { id: { in: createdRuns } } })
})

describe('adding', () => {
  it('adds a section, then an item in it — snapshot, state row and counters together', async () => {
    const run = await newDraft()
    const before = await reload(run.id)

    const section = await deploymentsService.addChecklistSection(adminCtx, run.id, {
      title: 'Project-specific checks',
      description: 'Added for this run only',
    })

    const item = await deploymentsService.addChecklistItem(adminCtx, run.id, section.id, {
      label: 'Robots.txt allows crawlers',
      helpText: null,
      isRequired: true,
      evidenceRequired: false,
    })

    const after = await reload(run.id)
    const added = after.checklist.sections.find((s) => s.id === section.id)
    expect(added?.title).toBe('Project-specific checks')
    expect(added?.items.map((i) => i.label)).toEqual(['Robots.txt allows crawlers'])
    // Hand-added items are their own lineage.
    expect(added?.items[0]?.sourceItemId).toBe(item.id)

    // The state row is born with the snapshot item, so it can be ticked.
    const state = await db.checklistItemState.findFirstOrThrow({
      where: { deploymentId: run.id, itemId: item.id },
    })
    expect(state.isRequired).toBe(true)
    expect(state.checked).toBe(false)

    expect(after.totalItems).toBe(before.totalItems + 1)
    expect(after.totalRequired).toBe(before.totalRequired + 1)
  })

  it('counts an added required item toward the gate', async () => {
    const run = await newDraft()
    const section = await deploymentsService.addChecklistSection(adminCtx, run.id, {
      title: 'Extra gate',
    })
    const item = await deploymentsService.addChecklistItem(adminCtx, run.id, section.id, {
      label: 'One more required thing',
      isRequired: true,
      evidenceRequired: false,
    })

    // Tick every ORIGINAL required item, leaving only the added one.
    const states = await db.checklistItemState.findMany({
      where: { deploymentId: run.id, isRequired: true, itemId: { not: item.id } },
    })
    await deploymentsService.transition(adminCtx, run.id, 'start')
    for (const state of states) {
      await deploymentsService.updateDeploymentItem(adminCtx, run.id, state.itemId, {
        checked: true,
        skipped: false,
        note: 'tailoring test',
      } as never)
    }

    // The added item is still outstanding — the gate must refuse.
    await expect(deploymentsService.transition(adminCtx, run.id, 'complete')).rejects.toThrow()

    await deploymentsService.updateDeploymentItem(adminCtx, run.id, item.id, {
      checked: true,
      skipped: false,
    } as never)
    const completed = await deploymentsService.transition(adminCtx, run.id, 'complete')
    expect(completed.status).toBe('COMPLETED')
  })
})

describe('editing', () => {
  it('edits an item and keeps the state row and totalRequired in step', async () => {
    const run = await newDraft()
    const before = await reload(run.id)
    const target = before.checklist.sections[0]!.items[0]!
    expect(target.isRequired).toBe(true)

    await deploymentsService.updateChecklistItem(adminCtx, run.id, target.id, {
      label: 'Renamed for this run',
      isRequired: false,
    })

    const after = await reload(run.id)
    const item = after.checklist.sections.flatMap((s) => s.items).find((i) => i.id === target.id)
    expect(item?.label).toBe('Renamed for this run')
    expect(item?.isRequired).toBe(false)

    const state = await db.checklistItemState.findFirstOrThrow({
      where: { deploymentId: run.id, itemId: target.id },
    })
    expect(state.isRequired).toBe(false)
    expect(after.totalRequired).toBe(before.totalRequired - 1)
    expect(after.totalItems).toBe(before.totalItems)
  })

  it('renames a section', async () => {
    const run = await newDraft()
    const sectionId = (await reload(run.id)).checklist.sections[0]!.id

    await deploymentsService.updateChecklistSection(adminCtx, run.id, sectionId, {
      title: 'Renamed section',
      description: null,
    })

    const after = await reload(run.id)
    const section = after.checklist.sections.find((s) => s.id === sectionId)
    expect(section?.title).toBe('Renamed section')
    expect(section?.description).toBeNull()
  })
})

describe('removing', () => {
  it('removes a checked item and corrects the completed counters', async () => {
    const run = await newDraft()
    const target = (await reload(run.id)).checklist.sections[0]!.items[0]!

    await deploymentsService.updateDeploymentItem(adminCtx, run.id, target.id, {
      checked: true,
      skipped: false,
      note: 'about to be removed',
    } as never)
    const ticked = await reload(run.id)
    expect(ticked.completedItems).toBe(1)

    await deploymentsService.removeChecklistItem(adminCtx, run.id, target.id)

    const after = await reload(run.id)
    expect(after.totalItems).toBe(ticked.totalItems - 1)
    expect(after.completedItems).toBe(0)
    expect(
      after.checklist.sections.flatMap((s) => s.items).some((i) => i.id === target.id),
    ).toBe(false)
    expect(
      await db.checklistItemState.count({ where: { deploymentId: run.id, itemId: target.id } }),
    ).toBe(0)
  })

  it('removes a section together with its item state rows', async () => {
    const run = await newDraft()
    const section = (await reload(run.id)).checklist.sections[0]!
    const itemIds = section.items.map((i) => i.id)
    expect(itemIds.length).toBeGreaterThan(0)

    await deploymentsService.removeChecklistSection(adminCtx, run.id, section.id)

    const after = await reload(run.id)
    expect(after.checklist.sections.some((s) => s.id === section.id)).toBe(false)
    expect(
      await db.checklistItemState.count({
        where: { deploymentId: run.id, itemId: { in: itemIds } },
      }),
    ).toBe(0)
    expect(after.totalItems).toBe(
      after.checklist.sections.reduce((n, s) => n + s.items.length, 0),
    )
  })
})

describe('refusals', () => {
  it('refuses every edit once the run has started', async () => {
    const run = await newDraft()
    const section = (await reload(run.id)).checklist.sections[0]!
    await deploymentsService.transition(adminCtx, run.id, 'start')

    await expect(
      deploymentsService.addChecklistSection(adminCtx, run.id, { title: 'Too late' }),
    ).rejects.toThrow(/still a draft/i)
    await expect(
      deploymentsService.addChecklistItem(adminCtx, run.id, section.id, {
        label: 'Too late',
        isRequired: true,
        evidenceRequired: false,
      }),
    ).rejects.toThrow(/still a draft/i)
    await expect(
      deploymentsService.removeChecklistItem(adminCtx, run.id, section.items[0]!.id),
    ).rejects.toThrow(/still a draft/i)
  })

  it('refuses a caller without deployment.edit', async () => {
    const run = await newDraft()
    await expect(
      deploymentsService.addChecklistSection(qaCtx, run.id, { title: 'No permission' }),
    ).rejects.toThrow(/deployment.edit/)
  })
})
