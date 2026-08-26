import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CreateItemSchema, CreateSectionSchema } from '@/features/admin/schemas/template-versions.schema'
import { templateVersionsService } from '@/features/admin/server/template-versions-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { db } from '@/lib/db/prisma'

/**
 * Adding and editing template items through the editor's actual payload shape.
 *
 * The editor's draft state models empty optional fields as null — matching the
 * embedded documents, which store null. The schemas used `.optional()`, which
 * rejects null, so creating any item whose "usual owner" was left as Anyone (the
 * default) failed with "Expected string, received null". Nobody had ever added
 * an item through the UI; every existing item came from the seed.
 *
 * The second half of the same defect: the service's update merged fields with
 * `??`, which reads a deliberate null ("clear this field") as "keep the old
 * value" — so once a help text existed it could never be removed.
 *
 * Requires a seeded database.
 */

let ctx: RequestContext
let templateId: string
let versionId: string

beforeAll(async () => {
  const org = await db.organization.findFirstOrThrow({ select: { id: true } })
  const admin = await db.user.findFirstOrThrow({
    where: { organizationId: org.id },
    select: { id: true },
  })

  ctx = {
    actorId: admin.id,
    actorType: 'user',
    actorEmail: 'template-items-test@example.com',
    actorName: 'Template Items Test',
    organizationId: org.id,
    roleKeys: ['admin'],
    permissions: { global: new Set(['*']), byProject: new Map(), isSuperAdmin: true },
    requestId: 'test-template-items',
    timezone: 'UTC',
  }

  const template = await db.checklistTemplate.create({
    data: {
      organizationId: org.id,
      key: `tpl-items-test-${Date.now()}`,
      name: 'Template Items Regression',
      createdById: admin.id,
      deletedAt: null,
    },
  })
  templateId = template.id

  const version = await db.templateVersion.create({
    data: {
      organizationId: org.id,
      templateId,
      version: 1,
      status: 'DRAFT',
      sections: [],
      createdById: admin.id,
      deletedAt: null,
    },
  })
  versionId = version.id
})

afterAll(async () => {
  await db.templateVersion.deleteMany({ where: { id: versionId } })
  await db.checklistTemplate.deleteMany({ where: { id: templateId } })
})

describe('the editor payload, exactly as the draft state sends it', () => {
  it('accepts null for every optional text field at the schema boundary', () => {
    // This exact shape produced "Expected string, received null".
    const item = CreateItemSchema.parse({
      label: 'Backup taken immediately before migration runs',
      helpText: null,
      key: null,
      isRequired: true,
      evidenceRequired: false,
      ownerRoleKey: null,
      environmentKeys: [],
    })
    expect(item.label).toContain('Backup')

    const section = CreateSectionSchema.parse({ title: 'UI/UX tests', description: null, key: null })
    expect(section.title).toBe('UI/UX tests')
  })

  it('creates an item with empty optional fields end to end', async () => {
    const section = await templateVersionsService.createSection(ctx, templateId, versionId, {
      title: 'UI/UX tests',
      description: null,
      key: null,
    })

    const item = await templateVersionsService.createItem(ctx, templateId, versionId, section.id, {
      label: 'Backup taken immediately before migration runs',
      helpText: null,
      key: null,
      isRequired: true,
      evidenceRequired: false,
      ownerRoleKey: null,
      environmentKeys: [],
    })

    expect(item.label).toContain('Backup')
    expect(item.helpText).toBeNull()
    expect(item.ownerRoleKey).toBeNull()
  })

  it('update treats null as "clear the field", not "keep the old value"', async () => {
    const section = await templateVersionsService.createSection(ctx, templateId, versionId, {
      title: 'Clearing semantics',
      description: null,
      key: null,
    })
    const item = await templateVersionsService.createItem(ctx, templateId, versionId, section.id, {
      label: 'Item with a note',
      helpText: 'Record the snapshot id.',
      key: 'sonar-passed',
      isRequired: true,
      evidenceRequired: false,
      ownerRoleKey: 'engineer',
      environmentKeys: [],
    })

    const cleared = await templateVersionsService.updateItem(
      ctx,
      templateId,
      versionId,
      section.id,
      item.id,
      { helpText: null, ownerRoleKey: null },
    )

    expect(cleared.helpText).toBeNull()
    expect(cleared.ownerRoleKey).toBeNull()
    // Untouched fields survive a partial update.
    expect(cleared.key).toBe('sonar-passed')
    expect(cleared.label).toBe('Item with a note')
  })
})
