/**
 * Domain errors.
 *
 * Pure — no framework, no HTTP. The transport layers map these to responses:
 * `src/lib/http/api-handler.ts` for REST, `toActionResult` for Server Actions.
 * Keeping the mapping in one place per transport means an error thrown deep in a
 * service produces the right status code without every service knowing about HTTP.
 */

export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode
  /** Safe to show a user. Internal detail goes in `details` and is logged, not returned. */
  abstract readonly httpStatus: number
  readonly details?: unknown

  constructor(message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.details = details
  }
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED' as const
  readonly httpStatus = 401

  constructor(readonly reason: string = 'no-session') {
    super('Authentication required')
  }
}

export class ForbiddenError extends AppError {
  readonly code = 'FORBIDDEN' as const
  readonly httpStatus = 403

  constructor(
    readonly permission: string,
    readonly scope?: { projectId?: string; isProductionEnvironment?: boolean },
  ) {
    super(`Missing permission: ${permission}`)
  }
}

/**
 * Also used for resources the actor may not see.
 *
 * Returning 403 for an existing-but-invisible resource confirms its existence to
 * someone with no right to know — a resource-enumeration oracle. 404 is the
 * correct answer to "does APEX-142 exist?" from someone without access.
 */
export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND' as const
  readonly httpStatus = 404

  /**
   * The id is captured on the instance for logs but deliberately kept OUT of the
   * message, for the reason in the header — echoing it back tells the caller which
   * ids exist. Both branches of the ternary that used to be here were identical,
   * which read as an unfinished intention rather than a decision.
   */
  constructor(entity: string, id?: string) {
    super(`${entity} not found`)
    this.entity = entity
    this.entityId = id
  }

  readonly entity: string
  readonly entityId?: string
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR' as const
  readonly httpStatus = 422

  constructor(
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message, fieldErrors)
  }
}

/**
 * The caller's copy is stale. `details` carries the authoritative state so an
 * optimistic client can reconcile silently instead of showing an error for what
 * is, during a release window, an entirely normal race.
 */
export class ConflictError extends AppError {
  readonly code = 'CONFLICT' as const
  readonly httpStatus = 409

  constructor(
    readonly reason: string,
    details?: unknown,
  ) {
    super(conflictMessage(reason), details)
  }
}

/**
 * The operation is not currently valid — an illegal state transition, or a
 * checklist gate that has not passed. Distinct from CONFLICT: the client is not
 * stale, the action is simply not allowed right now, and the UI should explain
 * why rather than silently retrying.
 */
export class PreconditionFailedError extends AppError {
  readonly code = 'PRECONDITION_FAILED' as const
  readonly httpStatus = 412

  constructor(
    readonly reason: string,
    details?: unknown,
  ) {
    super(preconditionMessage(reason), details)
  }
}

export class RateLimitError extends AppError {
  readonly code = 'RATE_LIMITED' as const
  readonly httpStatus = 429

  constructor(readonly retryAfterSeconds: number) {
    super('Too many requests. Please wait a moment and try again.')
  }
}

export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR' as const
  readonly httpStatus = 500

  constructor(message = 'Something went wrong', details?: unknown) {
    super(message, details)
  }
}

// ---------------------------------------------------------------------------
//  User-facing messages
// ---------------------------------------------------------------------------

function conflictMessage(reason: string): string {
  switch (reason) {
    case 'STALE_REVISION':
      return 'Someone else changed this a moment ago. Refreshing to the latest state.'
    case 'DUPLICATE_KEY':
      return 'Something with that name or key already exists.'
    case 'ALREADY_IN_STATE':
      return 'That change has already been applied.'
    default:
      return 'This conflicts with a change someone else made.'
  }
}

function preconditionMessage(reason: string): string {
  switch (reason) {
    case 'CHECKLIST_INCOMPLETE':
      return 'The checklist is not complete yet.'
    case 'RUN_NOT_IN_PROGRESS':
      return 'Checklist items can only be changed while a deployment is in progress.'
    case 'ILLEGAL_TRANSITION':
      return 'That is not a valid next step for this deployment.'
    case 'EVIDENCE_REQUIRED':
      return 'This item needs a note before it can be checked.'
    case 'NOT_ITEM_OWNER':
      return 'Only the person who checked this item can uncheck it.'
    case 'VERSION_PUBLISHED':
      return 'A published template version cannot be edited. Clone it to a draft first.'
    case 'TEMPLATE_EMPTY':
      return 'A template needs at least one section with one item before it can be published.'
    case 'LAST_SUPER_ADMIN':
      return 'This is the last administrator — removing their access would lock everyone out.'
    default:
      return 'This action is not available right now.'
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
