import type { RequestContext } from './authorize'

/**
 * Synthetic contexts for callers that have no HTTP request.
 *
 * Lives here, NOT in `src/server/context.ts`, because that module imports
 * NextAuth. Services need a context to attribute audit entries, and a service
 * that transitively depends on the web framework cannot be unit-tested without
 * booting it — which was the whole point of the layering.
 *
 * Pure: no I/O, no framework, no database.
 */

/**
 * Trusted internal actor for background jobs, migrations, and the seed.
 *
 * Granted the wildcard because these are trusted code paths rather than user
 * requests — a cron job blocked by a permission check would be a bug, not a
 * safeguard. `actorType: 'system'` keeps them distinguishable in the audit trail,
 * so "who completed this deployment" is never ambiguously attributed to a human.
 */
export function systemContext(organizationId: string, requestId = 'system'): RequestContext {
  return {
    actorId: 'system',
    actorType: 'system',
    actorEmail: 'system@internal',
    actorName: 'System',
    organizationId,
    roleKeys: [],
    permissions: { global: new Set(['*']), byProject: new Map(), isSuperAdmin: true },
    requestId,
    timezone: 'UTC',
  }
}

/**
 * Context for an unauthenticated actor performing a self-service action —
 * accepting an invitation, completing a password reset.
 *
 * Given NO permissions on purpose. These flows are authorised by possession of a
 * single-use token, not by a role, and the audit trail should say so. Attributing
 * them to `systemContext` would hide who actually acted.
 */
export function selfServiceContext(input: {
  organizationId: string
  userId: string
  email: string
  name: string
  requestId?: string
  ip?: string
  userAgent?: string
}): RequestContext {
  return {
    actorId: input.userId,
    actorType: 'user',
    actorEmail: input.email,
    actorName: input.name,
    organizationId: input.organizationId,
    roleKeys: [],
    permissions: { global: new Set(), byProject: new Map(), isSuperAdmin: false },
    requestId: input.requestId ?? 'self-service',
    ip: input.ip,
    userAgent: input.userAgent,
    timezone: 'UTC',
  }
}
