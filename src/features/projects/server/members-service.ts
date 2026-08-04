import 'server-only'

import { NotFoundError, ValidationError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import type { AddMemberInput, UpdateMemberInput } from '../schemas/members.schema'

/// Membership is one row per (user, project, role) — a member with three roles is
/// three rows. Callers think in terms of a member, so reads collapse rows by user
/// and writes replace the whole set for that user.
export class MembersService {
  private async assertProject(ctx: RequestContext, projectId: string) {
    return db.project.findFirstOrThrow({
      where: { id: projectId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, key: true },
    })
  }

  /**
   * The roles an administrator may grant on a project.
   *
   * `Role.isAssignableOnProject` has existed since the first schema and nothing
   * ever read it. Now that project grants are how people are given access, a role
   * flagged organization-only must not arrive here — otherwise a project
   * assignment becomes a way to hand out org-wide authority one project at a time.
   */
  async listAssignableRoles(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)

    return db.role.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, isAssignableOnProject: true },
      select: { id: true, key: true, name: true, description: true, isSuperAdmin: true },
      orderBy: { name: 'asc' },
    })
  }

  private async assertAssignableOnProject(ctx: RequestContext, roleIds: readonly string[]) {
    const roles = await db.role.findMany({
      where: { id: { in: [...roleIds] }, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true, isAssignableOnProject: true },
    })

    if (roles.length !== roleIds.length) {
      throw new NotFoundError('Role', 'one or more of the selected roles')
    }

    const orgOnly = roles.filter((role) => !role.isAssignableOnProject)
    if (orgOnly.length > 0) {
      throw new ValidationError(
        `"${orgOnly[0]!.name}" can only be granted organization-wide, not on a single project.`,
        { roleIds: orgOnly.map((r) => `"${r.name}" is organization-wide only`) },
      )
    }

    return roles
  }

  /**
   * Every project a user has been assigned, with the roles they hold on each.
   *
   * The admin surface works user-first — "which projects does Sonika have?" — while
   * Membership is stored project-first. This is that query, and it is deliberately
   * scoped by `user.read` rather than `project.members.manage`: it answers a
   * question about a person, and the caller is the user detail page.
   */
  async listUserProjects(ctx: RequestContext, userId: string) {
    requirePermission(ctx, PERMISSIONS.user.read)

    const rows = await db.membership.findMany({
      where: { userId, organizationId: ctx.organizationId, deletedAt: null },
      include: {
        project: { select: { id: true, name: true, key: true, deletedAt: true } },
        role: { select: { id: true, key: true, name: true } },
      },
      orderBy: { project: { name: 'asc' } },
    })

    const byProject = new Map<
      string,
      { project: { id: string; name: string; key: string }; roles: { id: string; name: string }[] }
    >()

    for (const row of rows) {
      /// A soft-deleted project keeps its membership rows; showing them would
      /// offer access to something no read can reach.
      if (row.project.deletedAt) continue

      const entry = byProject.get(row.projectId) ?? {
        project: { id: row.project.id, name: row.project.name, key: row.project.key },
        roles: [],
      }
      entry.roles.push(row.role)
      byProject.set(row.projectId, entry)
    }

    return [...byProject.values()]
  }

  async listProjectMembers(ctx: RequestContext, projectId: string) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)
    await this.assertProject(ctx, projectId)

    const rows = await db.membership.findMany({
      where: { projectId, organizationId: ctx.organizationId, deletedAt: null },
      include: {
        user: { select: { id: true, name: true, email: true, status: true, jobTitle: true } },
        role: { select: { id: true, key: true, name: true } },
      },
      orderBy: { user: { name: 'asc' } },
    })

    const byUser = new Map<string, { user: (typeof rows)[number]['user']; roles: (typeof rows)[number]['role'][]; membershipIds: string[] }>()
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? { user: row.user, roles: [], membershipIds: [] }
      entry.roles.push(row.role)
      entry.membershipIds.push(row.id)
      byUser.set(row.userId, entry)
    }

    return [...byUser.values()]
  }

  async addMember(ctx: RequestContext, projectId: string, input: AddMemberInput) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)
    const project = await this.assertProject(ctx, projectId)

    const user = await db.user.findFirstOrThrow({
      where: { id: input.userId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
    })

    const roles = await this.assertAssignableOnProject(ctx, input.roleIds)

    // Revive any soft-deleted rows rather than colliding with the unique index.
    await db.membership.updateMany({
      where: { projectId: project.id, userId: user.id, roleId: { in: roles.map((r) => r.id) } },
      data: { deletedAt: null },
    })

    const existing = await db.membership.findMany({
      where: { projectId: project.id, userId: user.id, deletedAt: null },
      select: { roleId: true },
    })
    const have = new Set(existing.map((e) => e.roleId))

    const missing = roles.filter((r) => !have.has(r.id))
    if (missing.length > 0) {
      await db.membership.createMany({
        data: missing.map((r) => ({
          organizationId: ctx.organizationId,
          projectId: project.id,
          userId: user.id,
          roleId: r.id,
          createdById: ctx.actorId,
        })),
      })
    }

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberAdded, {
      entityType: 'Membership',
      entityId: user.id,
      entityLabel: `${user.name} → ${project.key}`,
    })

    return this.getMember(ctx, project.id, user.id)
  }

  async updateMemberRoles(
    ctx: RequestContext,
    projectId: string,
    userId: string,
    input: UpdateMemberInput,
  ) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)
    const project = await this.assertProject(ctx, projectId)

    const user = await db.user.findFirstOrThrow({
      where: { id: userId, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
    })

    const roles = await this.assertAssignableOnProject(ctx, input.roleIds)

    const keep = roles.map((r) => r.id)

    await db.membership.updateMany({
      where: { projectId: project.id, userId: user.id, roleId: { notIn: keep }, deletedAt: null },
      data: { deletedAt: new Date() },
    })

    await db.membership.updateMany({
      where: { projectId: project.id, userId: user.id, roleId: { in: keep } },
      data: { deletedAt: null },
    })

    const existing = await db.membership.findMany({
      where: { projectId: project.id, userId: user.id, deletedAt: null },
      select: { roleId: true },
    })
    const have = new Set(existing.map((e) => e.roleId))

    const missing = keep.filter((id) => !have.has(id))
    if (missing.length > 0) {
      await db.membership.createMany({
        data: missing.map((roleId) => ({
          organizationId: ctx.organizationId,
          projectId: project.id,
          userId: user.id,
          roleId,
          createdById: ctx.actorId,
        })),
      })
    }

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberRoleChanged, {
      entityType: 'Membership',
      entityId: user.id,
      entityLabel: `${user.name} → ${project.key}`,
    })

    return this.getMember(ctx, project.id, user.id)
  }

  async removeMember(ctx: RequestContext, projectId: string, userId: string) {
    requirePermission(ctx, PERMISSIONS.project.membersManage)
    const project = await this.assertProject(ctx, projectId)

    const user = await db.user.findFirstOrThrow({
      where: { id: userId, organizationId: ctx.organizationId },
      select: { id: true, name: true },
    })

    const removed = await db.membership.updateMany({
      where: { projectId: project.id, userId: user.id, deletedAt: null },
      data: { deletedAt: new Date() },
    })

    if (removed.count === 0) {
      throw new Error(`${user.name} is not a member of ${project.key}.`)
    }

    await audit.record(db, ctx, AUDIT_ACTIONS.project.memberRemoved, {
      entityType: 'Membership',
      entityId: user.id,
      entityLabel: `${user.name} → ${project.key}`,
    })

    return { userId: user.id, projectId: project.id, removed: removed.count }
  }

  private async getMember(ctx: RequestContext, projectId: string, userId: string) {
    const rows = await db.membership.findMany({
      where: { projectId, userId, organizationId: ctx.organizationId, deletedAt: null },
      include: {
        user: { select: { id: true, name: true, email: true, status: true, jobTitle: true } },
        role: { select: { id: true, key: true, name: true } },
      },
    })

    return {
      user: rows[0]?.user ?? null,
      roles: rows.map((r) => r.role),
      membershipIds: rows.map((r) => r.id),
    }
  }
}

export const membersService = new MembersService()
