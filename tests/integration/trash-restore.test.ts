import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { adminProjectsService } from '@/features/admin/server/admin-projects-service'
import { environmentsService } from '@/features/admin/server/environments-service'
import { templatesService } from '@/features/admin/server/templates-service'
import { trashService } from '@/features/admin/server/trash-service'
import { usersService } from '@/features/admin/server/users-service'
import type { RequestContext } from '@/lib/authz/authorize'
import { PERMISSIONS, SEED_ROLES } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * Soft delete and restore — the half of Phase 2 that had a permission key, an
 * audit action and a disabled button, but no implementation.
 *
 * Requires a seeded database.
 */
let organizationId: string
let otherOrganizationId: string
let adminId: string
let adminName: string
let adminCtx: RequestContext

/** Ids created by this file, torn down at the end so the trash view stays clean. */
const createdProjects: string[] = []
const createdTemplates: string[] = []
const createdEnvironments: string[] = []

function ctxFor(roleKey: string, actorId: string, orgId = organizationId): RequestContext {
  const role = SEED_ROLES.find((r) => r.key === roleKey)
  if (!role) throw new Error(`No seeded role "${roleKey}"`)

  return {
    actorId,
    actorType: 'user',
    actorEmail: `${roleKey}@example.com`,
    actorName: roleKey,
    organizationId: orgId,
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

/** A context with an explicit permission set, for testing a single missing grant. */
function ctxWithPermissions(permissions: string[]): RequestContext {
  return {
    ...ctxFor('admin', adminId),
    roleKeys: ['scoped-test'],
    permissions: {
      global: new Set(permissions),
      byProject: new Map(),
      isSuperAdmin: false,
    },
  }
}

async function newProject(name: string) {
  const project = await adminProjectsService.createProject(adminCtx, { name })
  createdProjects.push(project.id)
  return project
}

beforeAll(async () => {
  const organization = await db.organization.findFirstOrThrow({ where: { slug: 'default' } })
  organizationId = organization.id

  const admin = await db.user.findFirstOrThrow({ where: { organizationId, deletedAt: null } })
  adminId = admin.id
  adminName = admin.name
  adminCtx = ctxFor('admin', admin.id)

  const other = await db.organization.upsert({
    where: { slug: 'trash-test-tenant' },
    update: {},
    create: { slug: 'trash-test-tenant', name: 'Trash Test Tenant' },
  })
  otherOrganizationId = other.id
})

afterAll(async () => {
  // Hard delete, not soft — these rows only exist to be asserted against.
  await db.project.deleteMany({ where: { id: { in: createdProjects } } })
  await db.templateVersion.deleteMany({ where: { templateId: { in: createdTemplates } } })
  await db.checklistTemplate.deleteMany({ where: { id: { in: createdTemplates } } })
  await db.environment.deleteMany({ where: { id: { in: createdEnvironments } } })
  await db.organization.deleteMany({ where: { id: otherOrganizationId } })
})

describe('project soft delete and restore', () => {
  it('round-trips a project through the trash', async () => {
    const project = await newProject(`Restore RoundTrip ${Date.now()}`)

    await adminProjectsService.deleteProject(adminCtx, project.id)

    // Gone from every default read...
    const live = await db.project.findFirst({ where: { id: project.id } })
    expect(live).toBeNull()

    // ...but present in the trash, and attributed.
    const trash = await trashService.listTrash(adminCtx)
    const entry = trash.find((t) => t.kind === 'project' && t.id === project.id)
    expect(entry).toBeDefined()
    expect(entry?.canRestore).toBe(true)
    /// The stored name, not ctx.actorName — the trash view resolves deletedById
    /// so the column still reads correctly long after the request that set it.
    expect(entry?.deletedBy).toBe(adminName)

    await trashService.restore(adminCtx, 'project', project.id)

    const restored = await db.project.findFirstOrThrow({ where: { id: project.id } })
    expect(restored.deletedAt).toBeNull()
    expect(restored.deletedById).toBeNull()
    expect(restored.key).toBe(project.key)

    const stillInTrash = await trashService.listTrash(adminCtx)
    expect(stillInTrash.some((t) => t.kind === 'project' && t.id === project.id)).toBe(false)
  })

  it('writes an audit entry for the restore', async () => {
    const project = await newProject(`Restore Audited ${Date.now()}`)
    await adminProjectsService.deleteProject(adminCtx, project.id)
    await adminProjectsService.restoreProject(adminCtx, project.id)

    const entry = await db.auditLog.findFirst({
      where: { organizationId, action: 'project.restored', entityId: project.id },
    })
    expect(entry).not.toBeNull()
  })

  it('refuses to restore without project.restore', async () => {
    const project = await newProject(`Restore Forbidden ${Date.now()}`)
    await adminProjectsService.deleteProject(adminCtx, project.id)

    // Holds read and delete, but not restore — deleting is not undoing.
    const ctx = ctxWithPermissions([PERMISSIONS.project.read, PERMISSIONS.project.delete])

    await expect(adminProjectsService.restoreProject(ctx, project.id)).rejects.toThrow()

    const stillDeleted = await db.project.findFirstOrThrow({
      where: { id: project.id, deletedAt: { not: null } },
    })
    expect(stillDeleted.deletedAt).not.toBeNull()
  })

  it('will not restore a project that was never deleted', async () => {
    const project = await newProject(`Restore Live ${Date.now()}`)

    await expect(adminProjectsService.restoreProject(adminCtx, project.id)).rejects.toThrow()
  })
})

describe('tenant scoping on delete', () => {
  it('refuses to delete a project belonging to another organization', async () => {
    const project = await newProject(`Cross Tenant ${Date.now()}`)

    // Same permissions, same id, different tenant. Before the scope check this
    // deleted the row: `update({ where: { id } })` verifies nothing else.
    const foreignCtx = ctxFor('admin', adminId, otherOrganizationId)

    await expect(adminProjectsService.deleteProject(foreignCtx, project.id)).rejects.toThrow()

    const untouched = await db.project.findFirstOrThrow({ where: { id: project.id } })
    expect(untouched.deletedAt).toBeNull()
  })

  it('keeps another organization out of the trash listing', async () => {
    const project = await newProject(`Cross Tenant Trash ${Date.now()}`)
    await adminProjectsService.deleteProject(adminCtx, project.id)

    const foreignCtx = ctxFor('admin', adminId, otherOrganizationId)
    const trash = await trashService.listTrash(foreignCtx)

    expect(trash.some((t) => t.id === project.id)).toBe(false)
  })
})

describe('unique keys survive a soft delete', () => {
  /**
   * `@@unique([organizationId, key])` does not exclude soft-deleted rows, so a
   * deleted project keeps its key reserved. The identifier probe used to filter
   * those rows out, report the key free, and hand `create` a duplicate — a
   * unique-index violation surfacing as an opaque 500.
   */
  it('suffixes around a deleted project holding the name', async () => {
    const name = `Collision ${Date.now()}`

    const first = await newProject(name)
    await adminProjectsService.deleteProject(adminCtx, first.id)

    const second = await newProject(name)

    expect(second.key).not.toBe(first.key)
    expect(second.slug).not.toBe(first.slug)
  })

  /**
   * The other side of the same index behaviour: because a deleted row keeps its
   * key, nothing can take it while it sits in the trash, so a restore always
   * gets its original identifiers back. This is what makes the collision branch
   * in restoreProject defensive rather than routine — it only becomes reachable
   * if deletedAt is ever added to the unique index, or if something writes keys
   * outside Prisma.
   */
  it('keeps a deleted project’s key reserved against it', async () => {
    const name = `Collision Reserved ${Date.now()}`

    const first = await newProject(name)
    await adminProjectsService.deleteProject(adminCtx, first.id)

    const second = await newProject(name)

    // Proof the key is still held: taking it by force is refused by the index.
    await expect(
      db.project.update({ where: { id: second.id }, data: { key: first.key } }),
    ).rejects.toThrow(/[Uu]nique constraint/)

    // So the restore is free to keep what it had.
    const restored = await adminProjectsService.restoreProject(adminCtx, first.id)
    expect(restored.key).toBe(first.key)
    expect(restored.slug).toBe(first.slug)
  })
})

describe('template restore', () => {
  it('round-trips a template through the trash', async () => {
    const template = await templatesService.createTemplate(adminCtx, {
      name: `Trash Template ${Date.now()}`,
      description: 'created by trash-restore.test.ts',
    } as never)
    createdTemplates.push(template.id)

    await templatesService.deleteTemplate(adminCtx, template.id)
    expect(await db.checklistTemplate.findFirst({ where: { id: template.id } })).toBeNull()

    await trashService.restore(adminCtx, 'template', template.id)

    const restored = await db.checklistTemplate.findFirstOrThrow({ where: { id: template.id } })
    expect(restored.deletedAt).toBeNull()
  })
})

describe('environment delete and restore', () => {
  async function newEnvironment() {
    const suffix = Date.now().toString().slice(-6)
    const env = await environmentsService.createEnvironment(adminCtx, {
      name: `Trash Env ${suffix}`,
      key: `trash_env_${suffix}`,
      color: '#334455',
      isProduction: false,
      order: 90,
    })
    createdEnvironments.push(env.id)
    return env
  }

  it('round-trips an unused environment', async () => {
    const env = await newEnvironment()

    await environmentsService.deleteEnvironment(adminCtx, env.id)
    expect(await db.environment.findFirst({ where: { id: env.id } })).toBeNull()

    await trashService.restore(adminCtx, 'environment', env.id)
    const restored = await db.environment.findFirstOrThrow({ where: { id: env.id } })
    expect(restored.deletedAt).toBeNull()
  })

  it('refuses to delete an environment a deployment still references', async () => {
    const inUse = await db.deploymentRun.findFirst({
      where: { organizationId, deletedAt: null },
      select: { environmentId: true },
    })

    // Only meaningful once a run exists; the deployment-flow suite creates them.
    if (!inUse) return

    await expect(
      environmentsService.deleteEnvironment(adminCtx, inUse.environmentId),
    ).rejects.toThrow(/cannot be deleted/i)
  })
})

describe('user delete and restore', () => {
  it('refuses to delete your own account', async () => {
    await expect(usersService.deleteUser(adminCtx, adminId)).rejects.toThrow(/your own account/i)
  })

  it('restores a user as deactivated rather than active', async () => {
    const suffix = Date.now().toString().slice(-8)
    const user = await db.user.create({
      data: {
        organizationId,
        email: `trash-restore-${suffix}@example.com`,
        name: 'Trash Restore Target',
        status: 'ACTIVE',
        roleIds: [],
      },
    })

    try {
      await usersService.deleteUser(adminCtx, user.id)

      const deleted = await db.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(deleted.deletedAt).not.toBeNull()
      /// A deleted account must not keep browsing on an unexpired JWT.
      expect(deleted.sessionEpoch).toBe(user.sessionEpoch + 1)

      await trashService.restore(adminCtx, 'user', user.id)

      const restored = await db.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(restored.deletedAt).toBeNull()
      expect(restored.status).toBe('DEACTIVATED')
    } finally {
      await db.user.deleteMany({ where: { id: user.id } })
    }
  })
})
