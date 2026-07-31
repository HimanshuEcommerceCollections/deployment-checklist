import 'server-only'

import { type RequestContext, can, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'

import { adminProjectsService } from './admin-projects-service'
import { environmentsService } from './environments-service'
import { templatesService } from './templates-service'
import { usersService } from './users-service'

/**
 * The restore bin.
 *
 * Every read here is the inverse of the default: `deletedAt: { not: null }`.
 * That is also what keeps the soft-delete extension out of the way — it only
 * appends `deletedAt: null` when the caller has not named the field, so a trash
 * query says what it means and gets what it asked for.
 *
 * `canRestore` is resolved per kind rather than assumed from `admin.access`,
 * because the permission catalog splits them: an operator may hold
 * `project.restore` and not `user.restore`. The page renders the button from
 * this, so the answer has to come from the same place the service enforces.
 */
export type TrashKind = 'project' | 'template' | 'environment' | 'user'

export interface TrashEntry {
  kind: TrashKind
  id: string
  label: string
  /** Secondary identifier — a project key, an email. Shown beside the label. */
  detail: string | null
  deletedAt: Date
  deletedBy: string | null
  canRestore: boolean
}

const RESTORE_PERMISSION: Record<TrashKind, string> = {
  project: PERMISSIONS.project.restore,
  template: PERMISSIONS.template.restore,
  environment: PERMISSIONS.environment.manage,
  user: PERMISSIONS.user.restore,
}

export class TrashService {
  async listTrash(ctx: RequestContext): Promise<TrashEntry[]> {
    requirePermission(ctx, PERMISSIONS.admin.access)

    const scope = { organizationId: ctx.organizationId, deletedAt: { not: null } } as const

    const [projects, templates, environments, users] = await Promise.all([
      db.project.findMany({
        where: scope,
        select: { id: true, name: true, key: true, deletedAt: true, deletedById: true },
        orderBy: { deletedAt: 'desc' },
      }),
      db.checklistTemplate.findMany({
        where: scope,
        select: { id: true, name: true, key: true, deletedAt: true, deletedById: true },
        orderBy: { deletedAt: 'desc' },
      }),
      db.environment.findMany({
        where: scope,
        select: { id: true, name: true, key: true, deletedAt: true },
        orderBy: { deletedAt: 'desc' },
      }),
      db.user.findMany({
        where: scope,
        select: { id: true, name: true, email: true, deletedAt: true },
        orderBy: { deletedAt: 'desc' },
      }),
    ])

    const deleterNames = await this.resolveDeleters([
      ...projects.map((p) => p.deletedById),
      ...templates.map((t) => t.deletedById),
    ])

    const permitted = (kind: TrashKind) => can(ctx, RESTORE_PERMISSION[kind])

    const entries: TrashEntry[] = [
      ...projects.map((p) => ({
        kind: 'project' as const,
        id: p.id,
        label: p.name,
        detail: p.key,
        deletedAt: p.deletedAt!,
        deletedBy: p.deletedById ? deleterNames.get(p.deletedById) ?? null : null,
        canRestore: permitted('project'),
      })),
      ...templates.map((t) => ({
        kind: 'template' as const,
        id: t.id,
        label: t.name,
        detail: t.key,
        deletedAt: t.deletedAt!,
        deletedBy: t.deletedById ? deleterNames.get(t.deletedById) ?? null : null,
        canRestore: permitted('template'),
      })),
      ...environments.map((e) => ({
        kind: 'environment' as const,
        id: e.id,
        label: e.name,
        detail: e.key,
        deletedAt: e.deletedAt!,
        /// Environment carries no deletedById column — the audit trail has it.
        deletedBy: null,
        canRestore: permitted('environment'),
      })),
      ...users.map((u) => ({
        kind: 'user' as const,
        id: u.id,
        label: u.name,
        detail: u.email,
        deletedAt: u.deletedAt!,
        deletedBy: null,
        canRestore: permitted('user'),
      })),
    ]

    return entries.sort((a, b) => b.deletedAt.getTime() - a.deletedAt.getTime())
  }

  /**
   * One lookup for every deleter across all kinds, rather than a join per row.
   * Deleters are themselves deletable, so this read must not filter on
   * `deletedAt` — an admin who deleted a project and later left the company
   * should still be named against it.
   */
  private async resolveDeleters(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))]
    if (unique.length === 0) return new Map<string, string>()

    const users = await db.user.findMany({
      where: { id: { in: unique }, deletedAt: undefined },
      select: { id: true, name: true },
    })

    return new Map(users.map((u) => [u.id, u.name]))
  }

  /**
   * Single entry point for the trash page's restore buttons. Each service owns
   * its own permission check and identifier-collision handling, so this only
   * routes — it must never grow rules of its own.
   */
  async restore(ctx: RequestContext, kind: TrashKind, id: string) {
    requirePermission(ctx, PERMISSIONS.admin.access)

    switch (kind) {
      case 'project':
        return adminProjectsService.restoreProject(ctx, id)
      case 'template':
        return templatesService.restoreTemplate(ctx, id)
      case 'environment':
        return environmentsService.restoreEnvironment(ctx, id)
      case 'user':
        return usersService.restoreUser(ctx, id)
    }
  }
}

export const trashService = new TrashService()
