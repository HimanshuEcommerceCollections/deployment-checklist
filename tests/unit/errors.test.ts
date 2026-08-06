import { describe, expect, it } from 'vitest'

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
} from '@/domain/shared/errors'
import { toActionResult } from '@/lib/http/action-result'

/**
 * The two error contracts the UI now depends on.
 *
 * 1. `AppError.digest` — Next.js strips messages from server errors in production
 *    but forwards a pre-set digest, and `(app)/error.tsx` reads it to render
 *    "you don't have access" instead of the generic crash screen. If the digest
 *    format drifts, permission denials silently degrade to crashes again.
 *
 * 2. `toActionResult` — AppError messages reach the browser; plain Errors are
 *    masked. Every service throw with user-facing intent must therefore be an
 *    AppError, and 26 of them were converted on exactly that basis.
 */

describe('AppError.digest', () => {
  it('encodes the code in the shape the error boundary parses', () => {
    expect(new ForbiddenError('deployment.create').digest).toBe('APP_ERROR;FORBIDDEN')
    expect(new ValidationError('nope').digest).toBe('APP_ERROR;VALIDATION_ERROR')
    expect(new NotFoundError('Project').digest).toBe('APP_ERROR;NOT_FOUND')
    expect(new ConflictError('STALE_REVISION').digest).toBe('APP_ERROR;CONFLICT')
    expect(new PreconditionFailedError('EVIDENCE_REQUIRED').digest).toBe(
      'APP_ERROR;PRECONDITION_FAILED',
    )
  })

  it('never collides with the digests Next uses for control flow', () => {
    // toActionResult rethrows NEXT_-prefixed digests so redirects keep working;
    // an APP_ERROR digest matching that pattern would turn every denial into a
    // swallowed redirect.
    expect(new ForbiddenError('x').digest.startsWith('NEXT_')).toBe(false)
  })
})

describe('toActionResult', () => {
  it('passes an AppError through with its message and code', () => {
    const result = toActionResult(new ValidationError('That slug is already taken.'))

    if (result.ok) throw new Error('expected a failure envelope')
    expect(result.message).toBe('That slug is already taken.')
    expect(result.code).toBe('VALIDATION_ERROR')
  })

  it('carries field errors to the form', () => {
    const result = toActionResult(
      new ValidationError('Your current password is incorrect.', {
        currentPassword: ['Incorrect password'],
      }),
    )

    if (result.ok) throw new Error('expected a failure envelope')
    expect(result.fieldErrors).toEqual({ currentPassword: ['Incorrect password'] })
  })

  it('masks a plain Error — internal messages are not for browsers', () => {
    const result = toActionResult(new Error('ECONNREFUSED 10.0.0.3:27017'))

    if (result.ok) throw new Error('expected a failure envelope')
    expect(result.message).not.toContain('ECONNREFUSED')
  })

  it('rethrows Next control-flow signals instead of swallowing them', () => {
    const redirect = Object.assign(new Error('redirect'), {
      digest: 'NEXT_REDIRECT;replace;/login',
    })

    expect(() => toActionResult(redirect)).toThrow()
  })

  it('does not mistake an AppError digest for control flow', () => {
    // AppError instances carry a digest too, and the isAppError branch must win.
    expect(() => toActionResult(new ForbiddenError('x'))).not.toThrow()
  })
})
