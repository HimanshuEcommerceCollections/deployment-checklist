import 'server-only'

import { headers } from 'next/headers'
import { cache } from 'react'

import { UnauthenticatedError } from '@/domain/shared/errors'
import { auth } from '@/lib/auth/auth'
import { type RequestContext, resolvePermissions } from '@/lib/authz/authorize'
import { db } from '@/lib/db/prisma'
import { logger } from '@/lib/logger'
import { runWithRequestStore } from '@/server/als'

// Re-exported for convenience. Defined in the authz layer so that services can
// build a context without importing this module, which pulls in NextAuth.
export { systemContext, selfServiceContext } from '@/lib/authz/system-context'

/**
 * Resolve the authenticated request context.
 *
 * Tier 2 of the two-tier verification described in docs/04 §4.1. `middleware.ts`
 * (Edge) only checks that a token is present and well-signed; this is the layer
 * that makes authorization decisions, and it is the authority.
 *
 * Wrapped in React's `cache()`, so a page performing twelve permission checks
 * costs exactly ONE database read. Without it, each check would re-query the
 * user and their roles.
 *
 * Throws UnauthenticatedError when there is no usable session — caught by the
 * route group's error boundary, which redirects to /login with a reason.
 */
export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const session = await auth()

  if (!session?.user?.id) throw new UnauthenticatedError('no-session')

  const user = await db.user.findFirst({
    where: { id: session.user.id, deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      sessionEpoch: true,
      organizationId: true,
      roleIds: true,
      timezone: true,
      memberships: {
        where: { deletedAt: null },
        select: { projectId: true, roleId: true },
      },
    },
  })

  if (!user) throw new UnauthenticatedError('user-removed')
  if (user.status !== 'ACTIVE') throw new UnauthenticatedError('user-inactive')

  // The revocation check. A JWT is stateless, so this is what makes suspension,
  // password change and role change take effect immediately rather than at token
  // expiry. Bumping User.sessionEpoch invalidates every outstanding token.
  if (user.sessionEpoch !== session.sessionEpoch) {
    throw new UnauthenticatedError('session-revoked')
  }

  const roles = await getRolesForOrganization(user.organizationId)
  const rolesById = new Map(roles.map((role) => [role.id, role]))

  const permissions = resolvePermissions({
    globalRoleIds: user.roleIds,
    memberships: user.memberships,
    rolesById,
    onStale: (roleKey, unknownKeys) =>
      logger.warn(
        { roleKey, unknownKeys },
        'role grants permissions that are no longer in the catalog — prune them in the admin UI',
      ),
  })

  const roleKeys = collectRoleKeys(user.roleIds, user.memberships, rolesById)
  const requestMeta = await getRequestMeta()

  return {
    actorId: user.id,
    actorType: 'user',
    actorEmail: user.email,
    actorName: user.name,
    organizationId: user.organizationId,
    roleKeys,
    permissions,
    requestId: requestMeta.requestId,
    ip: requestMeta.ip,
    userAgent: requestMeta.userAgent,
    timezone: user.timezone ?? 'UTC',
  }
})

/**
 * Roles for an organization.
 *
 * Read on essentially every request and changed a few times a year, so this is
 * the highest-value thing to keep out of the hot path. Request-scoped via
 * `cache()`; a cross-request cache would need tag invalidation on role edits and
 * the win over one indexed query is small.
 */
const getRolesForOrganization = cache(async (organizationId: string) => {
  return db.role.findMany({
    where: { organizationId, deletedAt: null },
    select: { id: true, key: true, permissions: true, isSuperAdmin: true },
  })
})

/**
 * Request metadata for audit entries.
 *
 * `x-forwarded-for` is only trustworthy behind a proxy that sets it — which is
 * every real deployment here (Vercel, or nginx). Taking the FIRST entry is
 * correct: later entries are client-supplied and forgeable.
 */
const getRequestMeta = cache(async () => {
  try {
    const headerList = await headers()
    const forwarded = headerList.get('x-forwarded-for')
    const ip =
      forwarded?.split(',')[0]?.trim() ||
      headerList.get('x-real-ip') ||
      undefined

    return {
      requestId: headerList.get('x-request-id') ?? crypto.randomUUID(),
      ip,
      userAgent: headerList.get('user-agent') ?? undefined,
    }
  } catch {
    // headers() is unavailable outside a request scope (jobs, tests).
    return { requestId: crypto.randomUUID(), ip: undefined, userAgent: undefined }
  }
})

function collectRoleKeys(
  globalRoleIds: readonly string[],
  memberships: readonly { roleId: string }[],
  rolesById: ReadonlyMap<string, { key: string }>,
): string[] {
  const keys = new Set<string>()
  for (const id of globalRoleIds) {
    const role = rolesById.get(id)
    if (role) keys.add(role.key)
  }
  for (const membership of memberships) {
    const role = rolesById.get(membership.roleId)
    if (role) keys.add(role.key)
  }
  return [...keys]
}

/**
 * Non-throwing variant. For layouts and components that render differently when
 * signed out rather than redirecting.
 */
export async function tryGetRequestContext(): Promise<RequestContext | null> {
  try {
    return await getRequestContext()
  } catch (error) {
    if (error instanceof UnauthenticatedError) return null
    throw error
  }
}

/**
 * Enter the tenant scope for the duration of a callback.
 *
 * The Prisma tenant extension reads organizationId from AsyncLocalStorage, so
 * every query inside is automatically scoped. Called from the authenticated
 * layout, which wraps the whole render.
 */
export async function withTenantScope<T>(ctx: RequestContext, fn: () => T): Promise<T> {
  return runWithRequestStore(
    {
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    fn,
  )
}
