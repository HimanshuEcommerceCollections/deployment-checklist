import 'server-only'

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Request-scoped store.
 *
 * Exists so tenant scoping cannot be forgotten. The Prisma tenant extension
 * reads organizationId from here and injects it into every query, which means a
 * developer who writes `db.project.findMany({})` still gets a correctly scoped
 * result rather than a cross-tenant leak.
 *
 * Kept in its own module (not in context.ts) because both the Prisma extension
 * and the request-context resolver need it, and importing context.ts from the
 * db layer would be a dependency cycle.
 */
export interface RequestStore {
  organizationId: string | null
  actorId: string | null
  requestId: string
  ip?: string
  userAgent?: string
}

const storage = new AsyncLocalStorage<RequestStore>()

export function runWithRequestStore<T>(store: RequestStore, fn: () => T): T {
  return storage.run(store, fn)
}

export function getRequestStore(): RequestStore | undefined {
  return storage.getStore()
}

export function getCurrentOrganizationId(): string | null {
  return storage.getStore()?.organizationId ?? null
}

export function getCurrentRequestId(): string | undefined {
  return storage.getStore()?.requestId
}

/**
 * Background jobs and the seed run OUTSIDE any request scope, so the tenant
 * extension must not inject anything. They pass organizationId explicitly.
 */
export function isInRequestScope(): boolean {
  return storage.getStore() !== undefined
}
