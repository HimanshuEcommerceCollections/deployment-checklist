import 'server-only'

import type {
  AssignableUser,
  ProjectMember,
} from '@/features/projects/components/project-members-manager'
import { membersService } from '@/features/projects/server/members-service'
import { type RequestContext, can } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

export interface MembersPanelData {
  canManage: boolean
  members: ProjectMember[]
  candidates: AssignableUser[]
}

/**
 * Everything the members panel needs, assembled once for every page that mounts
 * it — `/projects/[id]/members` and the admin Edit Project page. Duplicating
 * this assembly per page is how the two surfaces would eventually drift.
 *
 * Candidates are read straight from the tenant rather than through
 * usersService, which requires `user.read` — an actor may hold
 * `project.members.manage` on one project without being allowed to browse the
 * whole organization's user list. Only ACTIVE users are assignable: INVITED
 * accounts get their project grants on the invitation itself.
 */
export async function loadMembersPanelData(
  ctx: RequestContext,
  projectId: string,
): Promise<MembersPanelData> {
  const canManage = can(ctx, PERMISSIONS.project.membersManage, { projectId })
  if (!canManage) return { canManage, members: [], candidates: [] }

  const [memberRows, roleRows] = await Promise.all([
    membersService.listProjectMembers(ctx, projectId),
    db.role.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null },
      select: { id: true, name: true },
    }),
  ])

  const roleNames = Object.fromEntries(roleRows.map((role) => [role.id, role.name]))
  const named = (roleIds: string[]) =>
    roleIds.map((id) => roleNames[id]).filter((n): n is string => Boolean(n))

  const members: ProjectMember[] = memberRows.map((member) => ({
    userId: member.user.id,
    name: member.user.name,
    email: member.user.email,
    roleNames: named(member.user.roleIds),
  }))

  const assignedIds = new Set(members.map((m) => m.userId))

  const candidates: AssignableUser[] = (
    await db.user.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: null, status: 'ACTIVE' },
      select: { id: true, name: true, email: true, roleIds: true },
      orderBy: { name: 'asc' },
    })
  )
    .filter((user) => !assignedIds.has(user.id))
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      roleNames: named(user.roleIds),
    }))

  return { canManage, members, candidates }
}
