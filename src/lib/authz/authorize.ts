import 'server-only'

import { effectivePermissions } from '@/domain/authz/effective-permissions'
import { ForbiddenError } from '@/domain/shared/errors'

import {
  type Permission,
  WILDCARD,
  GLOBAL_ONLY_PERMISSIONS,
  pruneUnknown,
} from './permissions'

/**
 * The single authorization primitive of the system.
 *
 * Business logic asks `can(ctx, PERMISSIONS.deployment.complete, { projectId })`
 * and never inspects a role. Roles exist only as bags of permissions that the
 * resolver flattens before any code runs.
 *
 * Resolution order for a project-scoped check:
 *
 *   super-admin wildcard        →  allow everything
 *   global permissions          →  granted on every project
 *   project permissions         →  granted only on that project
 *   otherwise                   →  deny
 */

// ---------------------------------------------------------------------------
//  Context
// ---------------------------------------------------------------------------

export interface ActorPermissions {
  /** Org-wide grants, from User.roleIds → Role.permissions. */
  global: ReadonlySet<string>
  /** projectId → grants, from Membership → Role.permissions. */
  byProject: ReadonlyMap<string, ReadonlySet<string>>
  /** True when any granted role carries the WILDCARD. */
  isSuperAdmin: boolean
}

export interface RequestContext {
  actorId: string
  actorType: 'user' | 'api-key' | 'system' | 'cron'
  actorEmail: string
  actorName: string
  organizationId: string
  /** Role keys — for audit denormalisation and display ONLY. Never branch on these. */
  roleKeys: readonly string[]
  permissions: ActorPermissions
  requestId: string
  ip?: string
  userAgent?: string
  timezone: string
}

/** Narrows a check to a single project. Omit for org-wide permissions. */
export interface AuthorizeScope {
  projectId?: string
  /**
   * Set when the target environment is flagged `isProduction`. Adds an implicit
   * requirement for `deployment.production` on top of the requested permission,
   * so production access is configurable per role with no code change.
   */
  isProductionEnvironment?: boolean
}

// ---------------------------------------------------------------------------
//  Core evaluation
// ---------------------------------------------------------------------------

/**
 * Does this permission set satisfy the requirement?
 *
 * Supports three grant forms:
 *   "*"                  every permission
 *   "deployment.*"       every permission on the deployment resource
 *   "deployment.create"  exactly this permission
 *
 * Wildcards are matched on the resource prefix only — deliberately not a general
 * glob. `deployment.item.*` works because the prefix is `deployment.item`, but
 * there is no `*.create`, which would be almost impossible to reason about in a
 * role editor.
 */
export function satisfies(granted: ReadonlySet<string>, required: string): boolean {
  if (granted.has(WILDCARD)) return true
  if (granted.has(required)) return true

  // Walk prefixes right to left: "deployment.item.skip" tries
  // "deployment.item.*" then "deployment.*".
  let cut = required.lastIndexOf('.')
  while (cut > 0) {
    if (granted.has(`${required.slice(0, cut)}.${WILDCARD}`)) return true
    cut = required.lastIndexOf('.', cut - 1)
  }
  return false
}

/**
 * Non-throwing check. Use in UI-shaping code and anywhere a denial is a normal
 * outcome rather than an error.
 */
export function can(
  ctx: RequestContext,
  permission: Permission | string,
  scope: AuthorizeScope = {},
): boolean {
  const { permissions } = ctx
  if (permissions.isSuperAdmin) return true

  // Production escalation: an extra requirement, evaluated in the same scope.
  if (scope.isProductionEnvironment && permission !== 'deployment.production') {
    if (!can(ctx, 'deployment.production', { projectId: scope.projectId })) return false
  }

  if (satisfies(permissions.global, permission)) return true

  // Global-only permissions are never satisfied by a project grant, even if a
  // misconfigured role lists them. Prevents "Developer on Website" from
  // becoming a route to `settings.manage`.
  if (GLOBAL_ONLY_PERMISSIONS.has(permission)) return false

  if (scope.projectId) {
    const projectGrants = permissions.byProject.get(scope.projectId)
    if (projectGrants && satisfies(projectGrants, permission)) return true
  }

  return false
}

/** True when the permission is held on at least one project (or globally). */
export function canOnAnyProject(ctx: RequestContext, permission: Permission | string): boolean {
  if (ctx.permissions.isSuperAdmin) return true
  if (satisfies(ctx.permissions.global, permission)) return true
  for (const grants of ctx.permissions.byProject.values()) {
    if (satisfies(grants, permission)) return true
  }
  return false
}

/**
 * Project ids where the actor holds this permission — or `null` meaning
 * "every project" (global grant or super-admin).
 *
 * This is how list queries stay both correct and cheap: rather than filtering
 * in application code after fetching, the caller narrows the Prisma `where`.
 *
 *   const scope = projectScopeFor(ctx, PERMISSIONS.deployment.read)
 *   where: scope === null ? {} : { projectId: { in: scope } }
 *
 * An empty array means "no access anywhere" and must produce an empty result,
 * never an unfiltered query — see `projectFilter` below.
 */
export function projectScopeFor(
  ctx: RequestContext,
  permission: Permission | string,
): string[] | null {
  if (ctx.permissions.isSuperAdmin) return null
  if (satisfies(ctx.permissions.global, permission)) return null

  const ids: string[] = []
  for (const [projectId, grants] of ctx.permissions.byProject) {
    if (satisfies(grants, permission)) ids.push(projectId)
  }
  return ids
}

/**
 * Prisma `where` fragment for the actor's readable projects.
 *
 * The `in: []` case is the important one: MongoDB treats `$in: []` as matching
 * nothing, which is exactly right. Returning `{}` there would expose every row
 * to a user with no grants — the classic broken-authorization bug.
 */
export function projectFilter(
  ctx: RequestContext,
  permission: Permission | string,
  field = 'projectId',
): Record<string, unknown> {
  const scope = projectScopeFor(ctx, permission)
  if (scope === null) return {}
  return { [field]: { in: scope } }
}

// ---------------------------------------------------------------------------
//  Enforcement
// ---------------------------------------------------------------------------

/**
 * Throwing check. This is the call every service method makes before it does
 * anything else. `ForbiddenError` maps to 403 in the REST layer and to the
 * forbidden UI in the RSC layer.
 */
export function requirePermission(
  ctx: RequestContext,
  permission: Permission | string,
  scope: AuthorizeScope = {},
): void {
  if (!can(ctx, permission, scope)) throw new ForbiddenError(permission, scope)
}

/**
 * Throwing form of `canOnAnyProject`, for a read that is about to narrow itself.
 *
 * The gate a list method needs is "do they hold this anywhere", not "do they hold
 * it organization-wide". `requirePermission` with no scope only consults the global
 * grant set, so it rejects a user whose access comes from a project assignment —
 * before `projectFilter` on the next line gets the chance to return exactly the
 * rows they are entitled to.
 *
 * That combination is what kept project-scoped access dormant: the filter was
 * correct all along and the guard above it refused everyone it was written for.
 * Pair this coarse check with `projectFilter` in the query, which does the precise
 * scoping — never use it on its own to protect a single entity.
 */
export function requireAnyProject(ctx: RequestContext, permission: Permission | string): void {
  if (!canOnAnyProject(ctx, permission)) throw new ForbiddenError(permission, {})
}

/** Require every listed permission. */
export function requireAll(
  ctx: RequestContext,
  permissions: readonly (Permission | string)[],
  scope: AuthorizeScope = {},
): void {
  for (const permission of permissions) requirePermission(ctx, permission, scope)
}

/** Require at least one of the listed permissions. */
export function requireAny(
  ctx: RequestContext,
  permissions: readonly (Permission | string)[],
  scope: AuthorizeScope = {},
): void {
  if (!permissions.some((p) => can(ctx, p, scope))) {
    throw new ForbiddenError(permissions.join(' | '), scope)
  }
}

/**
 * Ownership-aware check for the `*_own` / `*_any` permission pairs.
 *
 *   requireOwnershipOr(ctx, comment.authorId,
 *     PERMISSIONS.comment.editOwn, PERMISSIONS.comment.moderate, { projectId })
 *
 * Keeps "edit mine" and "edit anyone's" as two grantable permissions instead of
 * an `if (isAuthor || isAdmin)` scattered across services.
 */
export function requireOwnershipOr(
  ctx: RequestContext,
  ownerId: string,
  ownPermission: Permission | string,
  anyPermission: Permission | string,
  scope: AuthorizeScope = {},
): void {
  if (ownerId === ctx.actorId && can(ctx, ownPermission, scope)) return
  requirePermission(ctx, anyPermission, scope)
}

// ---------------------------------------------------------------------------
//  Building the permission set
// ---------------------------------------------------------------------------

interface RoleRecord {
  id: string
  key: string
  permissions: string[]
  isSuperAdmin: boolean
}

/**
 * Flatten role documents into the resolved permission set attached to the
 * request context. Called once per request from `getRequestContext()`.
 *
 * ── Roles live on the user; assignment decides where they apply ──────────────
 * A user holds one set of roles. Each permission in them lands in one of two
 * places, decided by `globalOnly` in the catalog:
 *
 *   organization-scoped  →  the global set, in force everywhere
 *   project-scoped       →  every project the user is assigned to, and nowhere else
 *
 * That split is what makes "roles on the user, restricted to their projects"
 * possible at all. Putting a project-scoped permission in the global set would
 * make `projectScopeFor` return "every project" and assignment would mean
 * nothing — which is exactly what happened while roles were granted org-wide.
 *
 * A user with roles but no assignments therefore has organization-wide authority
 * and no project access, which is the correct reading of "not assigned to
 * anything" and is how a pure administrator resolves.
 *
 * Super-admin is unaffected: `can()` short-circuits on it before any of this, so
 * the wildcard role needs no assignment to see everything.
 *
 * Unknown keys are pruned rather than trusted: a role may still carry a
 * permission that a later release removed from the catalog. Pruning keeps the
 * grant inert; `onStale` surfaces it so it can be cleaned up instead of rotting.
 */
export function resolvePermissions(input: {
  /**
   * The user's roles — permission templates, not the final word. What they end up
   * with is these unioned, plus `extraPermissions`, minus `revokedPermissions`.
   */
  roleIds: readonly string[]
  /** Granted to this user on top of their roles. */
  extraPermissions?: readonly string[]
  /** Withheld from this user despite a role granting it. */
  revokedPermissions?: readonly string[]
  /** Projects the user is assigned to, in any order. */
  assignedProjectIds: readonly string[]
  rolesById: ReadonlyMap<string, RoleRecord>
  onStale?: (roleKey: string, unknownKeys: string[]) => void
}): ActorPermissions {
  const global = new Set<string>()
  const byProject = new Map<string, Set<string>>()

  const fromRoles: string[] = []
  let isSuperAdmin = false

  for (const roleId of input.roleIds) {
    const role = input.rolesById.get(roleId)
    if (!role) continue                                 // deleted role → no grants

    const { valid, unknown } = pruneUnknown(role.permissions)
    if (unknown.length && input.onStale) input.onStale(role.key, unknown)

    /**
     * Super-admin comes from the role and cannot be overridden per user. The
     * wildcard is rejected in both override lists at the boundary, so there is no
     * way to strip it from one person — which is deliberate: a revocable wildcard
     * would let someone remove the last administrator's authority without the
     * lockout guard, which reasons about roles, ever noticing.
     */
    if (role.isSuperAdmin || valid.includes(WILDCARD)) isSuperAdmin = true

    fromRoles.push(...valid)
  }

  /**
   * The per-user layer. `pruneUnknown` again on the extras: a key that left the
   * catalog must be inert here for the same reason it is inert on a role.
   */
  const { valid: extra } = pruneUnknown(input.extraPermissions ?? [])
  const effective = effectivePermissions(fromRoles, {
    extra,
    revoked: input.revokedPermissions ?? [],
  })

  const projectScoped = new Set<string>()

  for (const key of effective) {
    /**
     * The wildcard is deliberately organization-scoped. It belongs to the bootstrap
     * role, and confining it to assigned projects would leave a fresh install with
     * an administrator who cannot see the projects they just created.
     */
    if (key === WILDCARD || GLOBAL_ONLY_PERMISSIONS.has(key)) global.add(key)
    else projectScoped.add(key)
  }

  for (const projectId of input.assignedProjectIds) {
    let set = byProject.get(projectId)
    if (!set) byProject.set(projectId, (set = new Set()))
    for (const key of projectScoped) set.add(key)
  }

  return { global, byProject, isSuperAdmin }
}

/**
 * Serialisable projection for Client Components.
 *
 * Only what the UI needs to hide affordances — the server remains the sole
 * authority. Precomputing the answers means no permission logic and no role
 * data crosses into the client bundle.
 */
export function serializeAbilities(
  ctx: RequestContext,
  checks: ReadonlyArray<{ key: string; permission: string; scope?: AuthorizeScope }>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const check of checks) out[check.key] = can(ctx, check.permission, check.scope)
  return out
}
