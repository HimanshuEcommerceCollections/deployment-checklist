import 'server-only'

import { ZodError } from 'zod'

import { type ErrorCode, isAppError } from '@/domain/shared/errors'
import { logger } from '@/lib/logger'

/**
 * Server Action return envelope.
 *
 * Actions never throw across the boundary: an uncaught error in a Server Action
 * becomes an opaque digest in production, which is useless to both the user and
 * the developer. Every action returns this instead.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false
      code: ErrorCode
      message: string
      /** Applied directly to inputs by React Hook Form via form.setError. */
      fieldErrors?: Record<string, string[]>
      /** Structured detail the UI can render — outstanding items, fresh state. */
      details?: unknown
    }

export function ok(): ActionResult<undefined>
export function ok<T>(data: T): ActionResult<T>
export function ok<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data }
}

export function fail(
  code: ErrorCode,
  message: string,
  extra?: { fieldErrors?: Record<string, string[]>; details?: unknown },
): ActionResult<never> {
  return { ok: false, code, message, ...extra }
}

/**
 * Map a thrown error to an ActionResult. The single catch block every action uses.
 */
export function toActionResult(error: unknown, context?: { action?: string; requestId?: string }): ActionResult<never> {
  if (error instanceof ZodError) {
    const fieldErrors: Record<string, string[]> = {}
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_form'
      ;(fieldErrors[key] ??= []).push(issue.message)
    }
    return fail('VALIDATION_ERROR', firstIssueMessage(error), { fieldErrors })
  }

  if (isAppError(error)) {
    return fail(error.code, error.message, {
      fieldErrors: 'fieldErrors' in error ? (error.fieldErrors as Record<string, string[]>) : undefined,
      details: error.details,
    })
  }

  /**
   * Next.js control-flow signals (redirect, notFound) are thrown, not returned.
   * Swallowing them here would break navigation, so they are re-thrown.
   */
  if (isNextControlFlow(error)) throw error

  // Unrecognised: log with full detail, return nothing internal. An internal
  // message or stack in a client response is an information leak.
  logger.error({ err: error, ...context }, 'unhandled error in server action')
  return fail('INTERNAL_ERROR', 'Something went wrong. Please try again.')
}

function firstIssueMessage(error: ZodError): string {
  return error.issues[0]?.message ?? 'Please check the form and try again'
}

/**
 * `redirect()` and `notFound()` throw objects carrying a `digest` that Next
 * inspects. Catching them turns a redirect into a silent no-op, which is a
 * genuinely confusing bug to track down.
 */
function isNextControlFlow(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK)/.test(
      (error as { digest: string }).digest,
    )
  )
}
