/**
 * One-off cleanup for go-live (2026-08-31). Hard-deletes test-phase data:
 *
 *   • projects other than APEX, ELEV, FRESHBREATHT (+ their memberships and
 *     template links)
 *   • ALL deployment runs, their checklist item states and comments; resets
 *     the denormalised deployment counters on the kept projects
 *   • checklist templates other than production-deployment (+ their versions
 *     and project links)
 *
 * Keeps: all users, all history (audit logs, invitations, notification
 * outbox), environments, roles, settings, permission catalog, migration
 * ledger. The old Atlas cluster retains a full pre-cleanup copy.
 *
 * Idempotent — every delete is by filter, so re-running is a no-op.
 */
import './load-env'

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const KEEP_PROJECT_KEYS = ['APEX', 'ELEV', 'FRESHBREATHT']
const KEEP_TEMPLATE_KEYS = ['production-deployment']

async function run() {
  const org = await db.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error('no organization found')

  const removeProjects = await db.project.findMany({
    where: { organizationId: org.id, key: { notIn: KEEP_PROJECT_KEYS } },
    select: { id: true, key: true, name: true },
  })
  const removeTemplates = await db.checklistTemplate.findMany({
    where: { organizationId: org.id, key: { notIn: KEEP_TEMPLATE_KEYS } },
    select: { id: true, key: true, name: true },
  })
  const removeProjectIds = removeProjects.map((p) => p.id)
  const removeTemplateIds = removeTemplates.map((t) => t.id)

  console.log('\nRemoving projects:', removeProjects.map((p) => `${p.key} "${p.name}"`).join(', ') || '(none)')
  console.log('Removing templates:', removeTemplates.map((t) => `${t.key} "${t.name}"`).join(', ') || '(none)')

  // Deployment runs and their children — ALL of them, kept projects included.
  const states = await db.checklistItemState.deleteMany({})
  const comments = await db.deploymentComment.deleteMany({})
  const runs = await db.deploymentRun.deleteMany({})
  console.log(`\nDeployment runs: ${runs.count} deleted (${states.count} item states, ${comments.count} comments)`)

  const counters = await db.project.updateMany({
    where: { organizationId: org.id },
    data: { deploymentCount: 0, lastDeploymentAt: null, lastDeploymentEnv: null },
  })
  console.log(`Reset deployment counters on ${counters.count} projects`)

  // Template links first (they reference both sides), then versions, then parents.
  const links = await db.projectTemplate.deleteMany({
    where: { OR: [{ projectId: { in: removeProjectIds } }, { templateId: { in: removeTemplateIds } }] },
  })
  const versions = await db.templateVersion.deleteMany({ where: { templateId: { in: removeTemplateIds } } })
  const templates = await db.checklistTemplate.deleteMany({ where: { id: { in: removeTemplateIds } } })
  console.log(`Templates: ${templates.count} deleted (${versions.count} versions, ${links.count} project links)`)

  const memberships = await db.membership.deleteMany({ where: { projectId: { in: removeProjectIds } } })
  const projects = await db.project.deleteMany({ where: { id: { in: removeProjectIds } } })
  console.log(`Projects: ${projects.count} deleted (${memberships.count} memberships)`)

  console.log('\nUntouched: users, audit logs, invitations, notification outbox, environments, roles, settings.\n')
}

run()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void db.$disconnect())
