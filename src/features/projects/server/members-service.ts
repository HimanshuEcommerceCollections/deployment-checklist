import 'server-only'

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

    const roles = await db.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    })

    if (roles.length !== input.roleIds.length) {
      throw new Error('One or more roles do not exist in this organization.')
    }

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

    const roles = await db.role.findMany({
      where: { id: { in: input.roleIds }, organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true },
    })

    if (roles.length !== input.roleIds.length) {
      throw new Error('One or more roles do not exist in this organization.')
    }

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
