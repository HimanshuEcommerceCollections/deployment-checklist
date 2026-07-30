import { beforeAll, describe, expect, it } from 'vitest'

import { deploymentsService } from '@/features/deployments/server/deployments-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { PERMISSIONS, SEED_ROLES } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * Creating a deployment and ticking an item, end to end at the service layer.
 *
 * This is the application's core loop and had never been exercised: the route
 * that starts a run did not exist, so no run had ever been created and the
 * checklist page had nothing to render.
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

/** A context holding exactly one seeded role, org-wide. */
function ctxFor(roleKey: string, actorId: string): RequestContext {
  const role = SEED_ROLES.find((r) => r.key === roleKey)
  if (!role) throw new Error(`No seeded role "${roleKey}"`)

  const isSuperAdmin = 'isSuperAdmin' in role ? Boolean(role.isSuperAdmin) : false

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
      isSuperAdmin,
    },
    requestId: `test-${roleKey}`,
    timezone: 'UTC',
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

  const staging = await db.environment.findFirstOrThrow({
    where: { organizationId, key: 'staging', deletedAt: null },
  })
  stagingId = staging.id

  const production = await db.environment.findFirstOrThrow({
    where: { organizationId, isProduction: true, deletedAt: null },
  })
  productionId = production.id

  const admin = await db.user.findFirstOrThrow({ where: { organizationId, deletedAt: null } })
  adminCtx = ctxFor('admin', admin.id)
  engineerCtx = ctxFor('engineer', admin.id)
})

describe('creating a deployment', () => {
  it('snapshots the template and seeds one item state per item', async () => {
    const deployment = await deploymentsService.createDeployment(adminCtx, {
      projectId,
      templateVersionId,
      environmentId: stagingId,
      version: `0.0.0-test-${Date.now()}`,
      skipped: false,
    } as never)

    expect(deployment.status).toBe('DRAFT')
    expect(deployment.totalItems).toBeGreaterThan(0)
    expect(deployment.reference).toMatch(/^[A-Z]+-\d+$/)

    // The snapshot is the point: nothing in the execution path reads
    // TemplateVersion again, so a later template edit cannot rewrite this run.
    const snapshot = deployment.checklist as { templateVersionId: string; sections: unknown[] }
    expect(snapshot.templateVersionId).toBe(templateVersionId)
    expect(snapshot.sections.length).toBeGreaterThan(0)

    const states = await db.checklistItemState.count({ where: { deploymentId: deployment.id } })
    expect(states).toBe(deployment.totalItems)
  })

  it('allocates a per-project sequence rather than counting rows', async () => {
    const first = await deploymentsService.createDeployment(adminCtx, {
      projectId,
      templateVersionId,
      environmentId: stagingId,
      version: `0.0.0-seq-a-${Date.now()}`,
    } as never)

    const second = await deploymentsService.createDeployment(adminCtx, {
      projectId,
      templateVersionId,
      environmentId: stagingId,
      version: `0.0.0-seq-b-${Date.now()}`,
    } as never)

    expect(second.sequence).toBe(first.sequence + 1)
    expect(second.reference).not.toBe(first.reference)
  })

  it('refuses production to an actor without deployment.production', async () => {
    // The gate that makes Engineer safe: it is checked in addition to
    // deployment.create whenever the environment is flagged isProduction.
    expect(engineerCtx.permissions.global.has(PERMISSIONS.deployment.production)).toBe(false)

    await expect(
      deploymentsService.createDeployment(engineerCtx, {
        projectId,
        templateVersionId,
        environmentId: productionId,
        version: '0.0.0-should-not-exist',
      } as never),
    ).rejects.toThrow()
  })
})

describe('executing the checklist', () => {
  it('ticks an item and advances the completion counters', async () => {
    const deployment = await deploymentsService.createDeployment(adminCtx, {
      projectId,
      templateVersionId,
      environmentId: stagingId,
      version: `0.0.0-exec-${Date.now()}`,
    } as never)

    const item = await db.checklistItemState.findFirstOrThrow({
      where: { deploymentId: deployment.id },
      orderBy: { order: 'asc' },
    })

    await deploymentsService.updateDeploymentItem(adminCtx, deployment.id, item.itemId, {
      checked: true,
      skipped: false,
    })

    const after = await db.deploymentRun.findUniqueOrThrow({ where: { id: deployment.id } })
    expect(after.completedItems).toBe(1)

    const state = await db.checklistItemState.findUniqueOrThrow({ where: { id: item.id } })
    expect(state.checked).toBe(true)
  })
})
