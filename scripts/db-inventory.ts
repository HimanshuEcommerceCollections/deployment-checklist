/** One-off read-only inventory of the current database, for cleanup planning. */
import './load-env'

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function run() {
  const orgs = await db.organization.findMany()
  for (const o of orgs) {
    console.log(`ORGANIZATION: ${o.name} (slug: ${o.slug}, id: ${o.id}, created: ${o.createdAt.toISOString().slice(0, 10)}, deleted: ${o.deletedAt ? 'YES' : 'no'})`)
  }

  const envs = await db.environment.findMany({ orderBy: { order: 'asc' } })
  console.log(`\nENVIRONMENTS (${envs.length}):`)
  for (const e of envs) console.log(`  - ${e.key} "${e.name}" active=${e.isActive} deleted=${e.deletedAt ? 'YES' : 'no'}`)

  const roles = await db.role.findMany()
  console.log(`\nROLES (${roles.length}):`)
  for (const r of roles) {
    const holders = await db.user.count({ where: { roleIds: { has: r.id }, deletedAt: null } })
    console.log(`  - ${r.key} "${r.name}" system=${r.isSystem} superAdmin=${r.isSuperAdmin} holders=${holders} deleted=${r.deletedAt ? 'YES' : 'no'}`)
  }

  const users = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
  const roleById = new Map(roles.map((r) => [r.id, r.key]))
  console.log(`\nUSERS (${users.length}):`)
  for (const u of users) {
    const rs = u.roleIds.map((id) => roleById.get(id) ?? '?').join(',') || '(none)'
    console.log(`  - ${u.email} "${u.name}" status=${u.status} roles=[${rs}] created=${u.createdAt.toISOString().slice(0, 10)} lastLogin=${u.lastLoginAt ? u.lastLoginAt.toISOString().slice(0, 10) : 'never'} deleted=${u.deletedAt ? 'YES' : 'no'}`)
  }

  const projects = await db.project.findMany({ orderBy: { createdAt: 'asc' } })
  console.log(`\nPROJECTS (${projects.length}):`)
  for (const p of projects) {
    const runs = await db.deploymentRun.count({ where: { projectId: p.id } })
    const members = await db.membership.count({ where: { projectId: p.id, deletedAt: null } })
    console.log(`  - [${p.key}] "${p.name}" status=${p.status} runs=${runs} members=${members} created=${p.createdAt.toISOString().slice(0, 10)} deleted=${p.deletedAt ? 'YES' : 'no'}`)
  }

  const templates = await db.checklistTemplate.findMany()
  console.log(`\nCHECKLIST TEMPLATES (${templates.length}):`)
  for (const t of templates) {
    const versions = await db.templateVersion.findMany({ where: { templateId: t.id }, select: { version: true, status: true } })
    const v = versions.map((x) => `v${x.version}:${x.status}`).join(', ')
    console.log(`  - [${t.key}] "${t.name}" active=${t.isActive} versions=[${v}] deleted=${t.deletedAt ? 'YES' : 'no'}`)
  }

  const runs = await db.deploymentRun.findMany({ orderBy: { createdAt: 'asc' } })
  const projById = new Map(projects.map((p) => [p.id, p.key]))
  console.log(`\nDEPLOYMENT RUNS (${runs.length}):`)
  for (const r of runs) {
    console.log(`  - ${projById.get(r.projectId)}#${r.sequence} "${r.title}" env=${r.environmentKey} status=${r.status} version=${r.version ?? '-'} created=${r.createdAt.toISOString().slice(0, 10)} deleted=${r.deletedAt ? 'YES' : 'no'}`)
  }

  const itemStates = await db.checklistItemState.count()
  console.log(`\nCHECKLIST ITEM STATES: ${itemStates} (rows belonging to the runs above)`)

  const inviteGroups = await db.invitation.groupBy({ by: ['status'], _count: true })
  console.log(`\nINVITATIONS (${inviteGroups.reduce((n, g) => n + g._count, 0)}):`)
  for (const g of inviteGroups) console.log(`  - ${g.status}: ${g._count}`)

  const auditCount = await db.auditLog.count()
  const auditFirst = await db.auditLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
  const auditLast = await db.auditLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
  console.log(`\nAUDIT LOGS: ${auditCount} (${auditFirst?.createdAt.toISOString().slice(0, 10)} → ${auditLast?.createdAt.toISOString().slice(0, 10)})`)

  const outbox = await db.notificationOutbox.groupBy({ by: ['status'], _count: true })
  console.log(`\nNOTIFICATION OUTBOX (${outbox.reduce((n, g) => n + g._count, 0)}):`)
  for (const g of outbox) console.log(`  - ${g.status}: ${g._count}`)

  const memberships = await db.membership.count()
  const permDefs = await db.permissionDefinition.count()
  const dataMigrations = await db.dataMigration.count()
  console.log(`\nOTHER: memberships=${memberships}, permission_definitions=${permDefs} (code catalog), data_migrations=${dataMigrations} (ledger)`)
  console.log('EMPTY: auth_tokens, deployment_comments, api_keys, integrations, rate_limits, job_locks, deployment_daily_stats')
}

run()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void db.$disconnect())
