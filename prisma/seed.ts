/**
 * Idempotent seed.
 *
 * Upserts by natural key throughout, so it is safe to re-run on every deploy and
 * after every schema change. Produces a system you can immediately sign into.
 *
 *   npm run db:seed
 */
import '../scripts/load-env'

import { PrismaClient } from '@prisma/client'
import { hash } from '@node-rs/argon2'
import { nanoid } from 'nanoid'

import {
  PERMISSION_DEFINITIONS,
  SEED_ROLES,
} from '../src/lib/authz/permissions'
import {
  PRODUCTION_DEPLOYMENT_SECTIONS,
  QUICK_DEPLOY_SECTIONS,
  type SeedSection,
} from './seeds/production-deployment'

// The raw client on purpose: the tenant and soft-delete extensions assume a
// request scope, and the seed legitimately works across the whole database.
const db = new PrismaClient()

const ARGON_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const

const ENVIRONMENTS = [
  { key: 'development', name: 'Development', color: '#7d8ba3', order: 0, isProduction: false },
  { key: 'qa', name: 'QA', color: '#4fc7e8', order: 1, isProduction: false },
  { key: 'uat', name: 'UAT', color: '#a78bfa', order: 2, isProduction: false },
  { key: 'staging', name: 'Staging', color: '#f0b54c', order: 3, isProduction: false },
  { key: 'production', name: 'Production', color: '#ef5f6b', order: 4, isProduction: true, requiresApprove: true },
]

const PROJECTS = [
  { key: 'APEX', slug: 'apex', name: 'Apex', color: '#4fc7e8', description: 'Core customer-facing platform.' },
  { key: 'ELEV', slug: 'elevate', name: 'Elevate', color: '#35d68f', description: 'Analytics and reporting suite.' },
  { key: 'PORTAL', slug: 'internal-portal', name: 'Internal Portal', color: '#a78bfa', description: 'Employee tools and admin.' },
  { key: 'WEB', slug: 'website', name: 'Website', color: '#f0b54c', description: 'Marketing site and docs.' },
]

async function main() {
  const nodeEnv = process.env.NODE_ENV ?? 'development'
  const allowProduction = process.env.SEED_ALLOW_PRODUCTION === 'true'

  if (nodeEnv === 'production' && !allowProduction) {
    throw new Error(
      'Refusing to seed with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true if this is ' +
        'genuinely a first-run bootstrap of a production database.',
    )
  }

  console.log(`\nSeeding (${nodeEnv})…\n`)

  // ── Organization ─────────────────────────────────────────────────────────
  const organization = await db.organization.upsert({
    where: { slug: 'default' },
    create: {
      slug: 'default',
      name: process.env.SEED_ORG_NAME ?? 'Acme Engineering',
      // Explicit because the seed uses a raw client: Prisma reads
      // `deletedAt: null` on MongoDB as "present and null", so an absent field
      // makes the row invisible to every filtered read. See
      // src/lib/db/soft-delete-extension.ts.
      deletedAt: null,
    },
    update: { name: process.env.SEED_ORG_NAME ?? 'Acme Engineering' },
  })
  console.log(`  organization      ${organization.name}`)

  // ── Settings ─────────────────────────────────────────────────────────────
  await db.setting.upsert({
    where: { organizationId: organization.id },
    create: {
      organizationId: organization.id,
      companyName: organization.name,
      // console + local so a fresh clone works with no external accounts, and
      // nobody accidentally emails a real person from seeded data.
      emailProvider: 'console',
      storageProvider: 'local',
      timezone: 'UTC',
    },
    // Deliberately narrow: re-seeding must not stomp an admin's configuration.
    update: { companyName: organization.name },
  })
  console.log('  settings          ready')

  // ── Permission catalog ───────────────────────────────────────────────────
  // Seeded from code so the admin role editor can render groups and
  // descriptions without hardcoding a list in the UI.
  for (const [index, definition] of PERMISSION_DEFINITIONS.entries()) {
    await db.permissionDefinition.upsert({
      where: { key: definition.key },
      create: {
        key: definition.key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        globalOnly: definition.globalOnly ?? false,
        isDangerous: definition.dangerous ?? false,
        order: index,
      },
      update: {
        group: definition.group,
        label: definition.label,
        description: definition.description,
        globalOnly: definition.globalOnly ?? false,
        isDangerous: definition.dangerous ?? false,
        order: index,
      },
    })
  }
  console.log(`  permissions       ${PERMISSION_DEFINITIONS.length} definitions`)

  // ── Roles ────────────────────────────────────────────────────────────────
  const rolesByKey = new Map<string, string>()
  for (const role of SEED_ROLES) {
    const record = await db.role.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: role.key } },
      create: {
        organizationId: organization.id,
        key: role.key,
        name: role.name,
        description: role.description,
        color: role.color,
        permissions: [...role.permissions],
        isSystem: 'isSystem' in role ? role.isSystem : false,
        isSuperAdmin: 'isSuperAdmin' in role ? role.isSuperAdmin : false,
        isDefault: 'isDefault' in role ? role.isDefault : false,
        deletedAt: null,
      },
      // System roles keep their permissions in sync with code; customisable
      // roles are left alone so an admin's edits survive re-seeding.
      update:
        'isSystem' in role && role.isSystem
          ? { name: role.name, description: role.description, permissions: [...role.permissions] }
          : { description: role.description },
    })
    rolesByKey.set(role.key, record.id)
  }
  console.log(`  roles             ${SEED_ROLES.map((r) => r.key).join(', ')}`)

  // ── Environments ─────────────────────────────────────────────────────────
  const environmentsByKey = new Map<string, string>()
  for (const environment of ENVIRONMENTS) {
    const record = await db.environment.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: environment.key } },
      create: { organizationId: organization.id, ...environment, deletedAt: null },
      update: { name: environment.name, color: environment.color, order: environment.order },
    })
    environmentsByKey.set(environment.key, record.id)
  }
  console.log(`  environments      ${ENVIRONMENTS.map((e) => e.key).join(', ')}`)

  // ── Admin user ───────────────────────────────────────────────────────────
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase()
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeImmediately!2026'
  const adminRoleId = rolesByKey.get('admin')!

  const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } })

  const admin = existingAdmin
    ? await db.user.update({
        where: { id: existingAdmin.id },
        // Never reset an existing admin's password on re-seed — that would be a
        // rather effective way to lock someone out of their own system.
        data: { roleIds: { set: [adminRoleId] }, status: 'ACTIVE', deletedAt: null },
      })
    : await db.user.create({
        data: {
          organizationId: organization.id,
          email: adminEmail,
          name: process.env.SEED_ADMIN_NAME ?? 'Platform Admin',
          passwordHash: await hash(adminPassword, ARGON_OPTIONS),
          status: 'ACTIVE',
          roleIds: [adminRoleId],
          passwordChangedAt: new Date(),
          deletedAt: null,
        },
      })

  console.log(`  admin user        ${admin.email}${existingAdmin ? ' (existing, password unchanged)' : ''}`)

  // ── Projects ─────────────────────────────────────────────────────────────
  const projectsByKey = new Map<string, string>()
  for (const project of PROJECTS) {
    const record = await db.project.upsert({
      where: { organizationId_key: { organizationId: organization.id, key: project.key } },
      create: {
        organizationId: organization.id,
        ...project,
        status: 'ACTIVE',
        createdById: admin.id,
        searchText: `${project.name} ${project.key} ${project.description}`.toLowerCase(),
        deletedAt: null,
      },
      update: { name: project.name, description: project.description, color: project.color },
    })
    projectsByKey.set(project.key, record.id)
  }
  console.log(`  projects          ${PROJECTS.map((p) => p.name).join(', ')}`)

  // ── Templates ────────────────────────────────────────────────────────────
  const productionTemplateId = await seedTemplate({
    organizationId: organization.id,
    createdById: admin.id,
    key: 'production-deployment',
    name: 'Production Deployment',
    description:
      'The full pre-deployment checklist. Carried over from the original static checklist.',
    color: '#35d68f',
    sections: PRODUCTION_DEPLOYMENT_SECTIONS,
  })

  const quickTemplateId = await seedTemplate({
    organizationId: organization.id,
    createdById: admin.id,
    key: 'quick-deploy',
    name: 'Quick Deploy',
    description: 'Short checklist for development and QA environments.',
    color: '#4fc7e8',
    sections: QUICK_DEPLOY_SECTIONS,
  })

  // ── Project ↔ template links ─────────────────────────────────────────────
  for (const [index, projectKey] of PROJECTS.map((p) => p.key).entries()) {
    const projectId = projectsByKey.get(projectKey)!

    await db.projectTemplate.upsert({
      where: { projectId_templateId: { projectId, templateId: productionTemplateId } },
      create: {
        organizationId: organization.id,
        projectId,
        templateId: productionTemplateId,
        isDefault: true,
        order: 0,
        createdById: admin.id,
        deletedAt: null,
      },
      update: {},
    })

    await db.projectTemplate.upsert({
      where: { projectId_templateId: { projectId, templateId: quickTemplateId } },
      create: {
        organizationId: organization.id,
        projectId,
        templateId: quickTemplateId,
        isDefault: false,
        order: 1,
        environmentKeys: ['development', 'qa'],
        createdById: admin.id,
        deletedAt: null,
      },
      update: {},
    })

    void index
  }
  console.log('  template links    all projects → both templates')

  console.log('\nDone.\n')
  console.log('  Sign in at http://localhost:3000/login')
  console.log(`    email:    ${admin.email}`)
  if (!existingAdmin) console.log(`    password: ${adminPassword}`)
  console.log('\n  Emails print to this terminal (EMAIL_PROVIDER=console).\n')
}

/**
 * Create a template with a single PUBLISHED v1, or leave an existing one alone.
 *
 * Never overwrites existing versions: a published version is immutable by design,
 * and re-seeding must not rewrite a checklist that deployments have already
 * snapshotted from.
 */
async function seedTemplate(input: {
  organizationId: string
  createdById: string
  key: string
  name: string
  description: string
  color: string
  sections: SeedSection[]
}): Promise<string> {
  const existing = await db.checklistTemplate.findUnique({
    where: { organizationId_key: { organizationId: input.organizationId, key: input.key } },
    select: { id: true, currentVersionId: true },
  })

  if (existing?.currentVersionId) {
    console.log(`  template          ${input.name} (existing, untouched)`)
    return existing.id
  }

  const template =
    existing ??
    (await db.checklistTemplate.create({
      data: {
        organizationId: input.organizationId,
        key: input.key,
        name: input.name,
        description: input.description,
        color: input.color,
        createdById: input.createdById,
        searchText: `${input.name} ${input.key} ${input.description}`.toLowerCase(),
        deletedAt: null,
      },
      select: { id: true, currentVersionId: true },
    }))

  const sections = input.sections.map((section, sectionIndex) => ({
    id: nanoid(12),
    title: section.title,
    description: section.description ?? null,
    order: sectionIndex,
    items: section.items.map((item, itemIndex) => ({
      id: nanoid(12),
      label: item.label,
      helpText: item.helpText ?? null,
      order: itemIndex,
      isRequired: item.isRequired ?? true,
      evidenceRequired: item.evidenceRequired ?? false,
      environmentKeys: item.environmentKeys ?? [],
    })),
  }))

  const itemCount = sections.reduce((total, section) => total + section.items.length, 0)
  const requiredCount = sections.reduce(
    (total, section) => total + section.items.filter((item) => item.isRequired).length,
    0,
  )

  const version = await db.templateVersion.create({
    data: {
      organizationId: input.organizationId,
      templateId: template.id,
      version: 1,
      status: 'PUBLISHED',
      changeNote: 'Initial version.',
      sections,
      completionPolicy: 'ALL_REQUIRED',
      sectionCount: sections.length,
      itemCount,
      requiredCount,
      publishedAt: new Date(),
      publishedById: input.createdById,
      createdById: input.createdById,
      deletedAt: null,
    },
    select: { id: true },
  })

  await db.checklistTemplate.update({
    where: { id: template.id },
    data: { currentVersionId: version.id, currentVersion: 1, versionCounter: 1 },
  })

  console.log(
    `  template          ${input.name} v1 — ${sections.length} sections, ${itemCount} items (${requiredCount} required)`,
  )

  return template.id
}

main()
  .catch((error) => {
    console.error('\nSeed failed:\n')
    console.error(error)
    process.exit(1)
  })
  .finally(() => void db.$disconnect())
