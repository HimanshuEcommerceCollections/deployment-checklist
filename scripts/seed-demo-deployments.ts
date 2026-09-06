/**
 * Demo data for the deployments index (search / filters / pagination).
 *
 *   npx tsx scripts/seed-demo-deployments.ts          → (re)create the demo set
 *   npx tsx scripts/seed-demo-deployments.ts --clean  → remove it entirely
 *
 * Everything lands in ONE dedicated project (key PLAYGROUND) so real projects
 * stay untouched and removal is a single --clean run. Runs are written directly
 * with Prisma (the services import 'server-only'), mirroring what
 * DeploymentsService.createDeployment writes: a frozen checklist snapshot from
 * the published production-deployment template, per-item state rows, and the
 * denormalised counters the tables read. Deterministic, so re-runs produce the
 * same spread.
 */
import './load-env'

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const PROJECT_KEY = 'PLAYGROUND'
const RUN_COUNT = 35

/** Deterministic pseudo-randomness — same demo set on every reseed. */
let rngState = 42
function rng(): number {
  rngState = (rngState * 1103515245 + 12345) % 2147483648
  return rngState / 2147483648
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]!

const TITLES = [
  'Marketing site refresh', 'Checkout hotfix', 'Search relevance tuning',
  'Payment webhook retry fix', 'Homepage banner rollout', 'Catalog sync upgrade',
  'Order export rework', 'CDN cache overhaul', 'Login rate-limit tweak',
  'Inventory dashboard', null, null, // some runs go out with no title
] as const

const STATUS_PLAN = [
  ...Array<'DRAFT'>(7).fill('DRAFT'),
  ...Array<'IN_PROGRESS'>(6).fill('IN_PROGRESS'),
  ...Array<'BLOCKED'>(3).fill('BLOCKED'),
  ...Array<'COMPLETED'>(13).fill('COMPLETED'),
  ...Array<'FAILED'>(3).fill('FAILED'),
  ...Array<'CANCELLED'>(2).fill('CANCELLED'),
  ...Array<'ROLLED_BACK'>(1).fill('ROLLED_BACK'),
] as const

async function clean(projectId: string) {
  const runs = await db.deploymentRun.findMany({ where: { projectId }, select: { id: true } })
  await db.checklistItemState.deleteMany({
    where: { deploymentId: { in: runs.map((r) => r.id) } },
  })
  await db.deploymentComment.deleteMany({
    where: { deploymentId: { in: runs.map((r) => r.id) } },
  })
  const removed = await db.deploymentRun.deleteMany({ where: { projectId } })
  return removed.count
}

async function run() {
  const organization = await db.organization.findFirstOrThrow()
  const admin = await db.user.findFirstOrThrow({
    where: { organizationId: organization.id, status: 'ACTIVE', deletedAt: null },
    orderBy: { createdAt: 'asc' },
  })
  const checkers = await db.user.findMany({
    where: { organizationId: organization.id, status: 'ACTIVE', deletedAt: null },
    select: { id: true, name: true },
    take: 6,
  })

  const existing = await db.project.findFirst({
    where: { organizationId: organization.id, key: PROJECT_KEY },
  })

  if (process.argv.includes('--clean')) {
    if (!existing) return console.log('Nothing to clean — no PLAYGROUND project.')
    const count = await clean(existing.id)
    await db.membership.deleteMany({ where: { projectId: existing.id } })
    await db.projectTemplate.deleteMany({ where: { projectId: existing.id } })
    await db.project.delete({ where: { id: existing.id } })
    return console.log(`Removed the Playground project and its ${count} demo runs.`)
  }

  const template = await db.checklistTemplate.findFirstOrThrow({
    where: { organizationId: organization.id, key: 'production-deployment', deletedAt: null },
  })
  const version = await db.templateVersion.findFirstOrThrow({
    where: { templateId: template.id, status: 'PUBLISHED', deletedAt: null },
    orderBy: { version: 'desc' },
  })
  const environments = await db.environment.findMany({
    where: { organizationId: organization.id, isActive: true, deletedAt: null },
    orderBy: { order: 'asc' },
  })

  const project = existing
    ? await db.project.update({ where: { id: existing.id }, data: { deletedAt: null } })
    : await db.project.create({
        data: {
          organizationId: organization.id,
          key: PROJECT_KEY,
          slug: 'playground',
          name: 'Playground (Demo)',
          description: 'Demo data for trying the deployments index. Safe to delete.',
          color: '#f0b54c',
          status: 'ACTIVE',
          createdById: admin.id,
          searchText: 'playground demo',
          deletedAt: null,
        },
      })

  const cleaned = await clean(project.id)
  if (cleaned > 0) console.log(`Cleared ${cleaned} previous demo runs.`)

  const now = Date.now()
  const DAY = 24 * 60 * 60 * 1000
  let major = 1
  let minor = 0

  for (let index = 0; index < RUN_COUNT; index++) {
    const status = STATUS_PLAN[index % STATUS_PLAN.length]!
    const environment = pick(environments)
    // Oldest first so sequences read chronologically, newest ~today.
    const createdAt = new Date(now - (RUN_COUNT - index) * 1.7 * DAY + rng() * 0.9 * DAY)
    const title = pick(TITLES)
    if (rng() > 0.6) minor++
    if (rng() > 0.9) {
      major++
      minor = 0
    }
    const versionLabel = `${major}.${minor}.${Math.floor(rng() * 9)}`

    // Same shape createDeployment freezes: live sections, env-filtered items.
    const sections = version.sections
      .filter((s) => !s.deletedAt)
      .map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        order: s.order,
        sourceSectionId: s.id,
        items: s.items
          .filter((i) => !i.deletedAt)
          .filter(
            (i) => i.environmentKeys.length === 0 || i.environmentKeys.includes(environment.key),
          )
          .map((i) => ({
            id: i.id,
            label: i.label,
            helpText: i.helpText,
            order: i.order,
            isRequired: i.isRequired,
            evidenceRequired: i.evidenceRequired,
            ownerRoleKey: i.ownerRoleKey,
            metadata: i.metadata ?? undefined,
            sourceItemId: i.id,
          })),
      }))
      .filter((s) => s.items.length > 0)

    const flat = sections.flatMap((s) => s.items.map((i) => ({ ...i, sectionId: s.id })))

    const checkedRatio =
      status === 'COMPLETED' ? 1
      : status === 'DRAFT' ? 0
      : status === 'IN_PROGRESS' || status === 'BLOCKED' ? 0.3 + rng() * 0.5
      : 0.2 + rng() * 0.4 // failed / cancelled / rolled back stopped part-way
    const checkedCount = Math.round(flat.length * checkedRatio)

    const startedAt = status === 'DRAFT' ? null : new Date(createdAt.getTime() + 2 * 60 * 60 * 1000)
    const endedAt = startedAt ? new Date(startedAt.getTime() + (1 + rng() * 20) * 60 * 60 * 1000) : null
    const starter = pick(checkers)

    const deployment = await db.deploymentRun.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        reference: `${PROJECT_KEY}-${index + 1}`,
        sequence: index + 1,
        templateId: template.id,
        templateVersionId: version.id,
        checklist: {
          templateId: template.id,
          templateVersionId: version.id,
          templateKey: template.key,
          templateName: template.name,
          version: version.version,
          completionPolicy: version.completionPolicy,
          capturedAt: createdAt,
          sections,
        },
        environmentId: environment.id,
        environmentKey: environment.key,
        environmentName: environment.name,
        isProduction: environment.isProduction,
        version: versionLabel,
        title,
        status,
        totalItems: flat.length,
        totalRequired: flat.filter((i) => i.isRequired).length,
        completedItems: checkedCount,
        completedRequired: Math.min(checkedCount, flat.filter((i) => i.isRequired).length),
        startedAt,
        startedById: startedAt ? starter.id : null,
        startedByName: startedAt ? starter.name : null,
        ...(status === 'COMPLETED' && {
          completedAt: endedAt,
          completedById: starter.id,
          completedByName: starter.name,
          durationMs: endedAt && startedAt ? endedAt.getTime() - startedAt.getTime() : null,
        }),
        ...(status === 'FAILED' && { failedAt: endedAt, failedById: starter.id, failureReason: 'Smoke tests failed on the demo run.' }),
        ...(status === 'CANCELLED' && { cancelledAt: endedAt, cancelledById: starter.id, cancelReason: 'Superseded by a newer demo release.' }),
        ...(status === 'ROLLED_BACK' && { rolledBackAt: endedAt, rolledBackById: starter.id, rollbackReason: 'Error rate spiked after the demo release.' }),
        createdById: admin.id,
        createdAt,
        searchText: [versionLabel, title, PROJECT_KEY, environment.name].filter(Boolean).join(' '),
        // Raw PrismaClient omits unset optionals, and Mongo's `deletedAt: null`
        // filter only matches a PRESENT null — see the soft-delete extension.
        deletedAt: null,
      },
    })

    await db.checklistItemState.createMany({
      data: flat.map((item, itemIndex) => {
        const checked = itemIndex < checkedCount
        const checker = pick(checkers)
        return {
          organizationId: organization.id,
          deploymentId: deployment.id,
          sectionId: item.sectionId,
          itemId: item.id,
          order: item.order,
          isRequired: item.isRequired,
          checked,
          checkedAt: checked && startedAt ? new Date(startedAt.getTime() + itemIndex * 9 * 60 * 1000) : null,
          checkedById: checked ? checker.id : null,
          checkedByName: checked ? checker.name : null,
          note: checked && item.evidenceRequired ? 'Verified on the demo run.' : null,
          revision: checked ? 1 : 0,
          toggleCount: checked ? 1 : 0,
        }
      }),
    })

    console.log(`  ${deployment.reference}  ${status.padEnd(12)} ${environment.key.padEnd(11)} v${versionLabel}  ${createdAt.toISOString().slice(0, 10)}  ${checkedCount}/${flat.length}`)
  }

  const latest = await db.deploymentRun.findFirstOrThrow({
    where: { projectId: project.id },
    orderBy: { createdAt: 'desc' },
  })
  await db.project.update({
    where: { id: project.id },
    data: {
      deploymentCount: RUN_COUNT,
      lastDeploymentAt: latest.createdAt,
      lastDeploymentEnv: latest.environmentKey,
    },
  })

  console.log(`\nSeeded ${RUN_COUNT} demo runs in "${project.name}" (${PROJECT_KEY}).`)
  console.log('Open the project and click the Deployments card. Remove with --clean.\n')
}

run()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => void db.$disconnect())
