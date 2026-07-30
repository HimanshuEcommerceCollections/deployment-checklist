import 'server-only'

import { type RequestContext, projectFilter, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

/**
 * Visibility comes from the permission layer, not from Membership rows.
 *
 * These reads used to filter on `memberships: { some: { userId } }`, which made
 * "a membership row exists" the access rule and ignored permissions entirely. Two
 * consequences, both bad: a global role granted permission but no visibility, and
 * `can()`'s super-admin short-circuit was bypassed because a raw Prisma filter
 * cannot know about it — so a fresh install showed nobody any project, including
 * the administrator.
 *
 * `projectFilter` resolves the same question through the authz layer:
 *   global grant / super-admin → {}                 every project
 *   project-scoped grants      → { id: { in: [..] } }
 *   nothing                    → { id: { in: [] } } no rows, never all rows
 *
 * Project-scoped grants keep working the moment a Membership exists, so this is
 * not a removal of that capability — it stops *requiring* it. See docs/14.
 */
export class ProjectsService {
  async listUserProjects(ctx: RequestContext) {
    requirePermission(ctx, PERMISSIONS.project.read)

    return db.project.findMany({
      where: {
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...projectFilter(ctx, PERMISSIONS.project.read, 'id'),
      },
      include: {
        _count: { select: { memberships: true, deployments: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getProject(ctx: RequestContext, id: string) {
    requirePermission(ctx, PERMISSIONS.project.read)

    return db.project.findFirstOrThrow({
      where: {
        id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        ...projectFilter(ctx, PERMISSIONS.project.read, 'id'),
      },
      include: {
        memberships: { where: { deletedAt: null }, include: { user: true } },
        _count: { select: { deployments: true } },
      },
    })
  }
}

export const projectsService = new ProjectsService()
