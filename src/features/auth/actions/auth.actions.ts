'use server'

import { AuthError } from 'next-auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { signIn, signOut } from '@/lib/auth/auth'
import { type ActionResult, fail, ok, toActionResult } from '@/lib/http/action-result'

import {
  AcceptInviteSchema,
  ForgotPasswordSchema,
  LoginSchema,
  ResetPasswordSchema,
} from '../schemas/auth.schema'
import { authService } from '../server/auth-service'
import { invitationService } from '../server/invitation-service'
import { passwordService } from '../server/password-service'

/**
 * Auth Server Actions.
 *
 * Thin: parse → call a service → map the result. No business rules here.
 */

export async function login(raw: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const input = LoginSchema.parse(raw)
    const redirectTo = safeNext(input.next)

    try {
      // redirect:false — we return the target so the client can navigate, rather
      // than letting Auth.js throw NEXT_REDIRECT through our result envelope.
      await signIn('credentials', {
        email: input.email,
        password: input.password,
        redirect: false,
      })
    } catch (error) {
      if (error instanceof AuthError) {
        // One message for every credential failure. The exception is a pending
        // invitation, where a hint helps the user far more than it helps an
        // attacker — that account cannot be signed into regardless.
        const reason = await authService.explainFailure(input.email)

        if (reason === 'PENDING_INVITE') {
          return fail(
            'UNAUTHENTICATED',
            'This account has not been set up yet. Check your inbox for the invitation email.',
          )
        }
        if (reason === 'LOCKED') {
          return fail(
            'RATE_LIMITED',
            'Too many failed attempts. Please wait a few minutes and try again.',
          )
        }
        return fail('UNAUTHENTICATED', 'Invalid email or password.')
      }
      throw error
    }

    return ok({ redirectTo })
  } catch (error) {
    return toActionResult(error, { action: 'login' })
  }
}

export async function logout(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

/**
 * Always reports success, whether or not the account exists.
 *
 * The service applies rate limiting internally and returns silently, so the
 * response and its latency are indistinguishable either way.
 */
export async function requestPasswordReset(raw: unknown): Promise<ActionResult<undefined>> {
  try {
    const input = ForgotPasswordSchema.parse(raw)
    const meta = await requestMeta()

    await passwordService.requestReset(input.email, meta)

    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'requestPasswordReset' })
  }
}

export async function resetPassword(raw: unknown): Promise<ActionResult<{ email: string }>> {
  try {
    const input = ResetPasswordSchema.parse(raw)
    const meta = await requestMeta()

    const result = await passwordService.completeReset(input, meta)

    return ok(result)
  } catch (error) {
    return toActionResult(error, { action: 'resetPassword' })
  }
}

export async function acceptInvite(raw: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  try {
    const input = AcceptInviteSchema.parse(raw)
    const meta = await requestMeta()

    const user = await invitationService.accept(input, meta)

    // Straight into the app — a second login immediately after setting a
    // password is friction with no security benefit.
    await signIn('credentials', {
      email: user.email,
      password: input.password,
      redirect: false,
    })

    return ok({ redirectTo: '/dashboard?welcome=1' })
  } catch (error) {
    return toActionResult(error, { action: 'acceptInvite' })
  }
}

/** Used by the login page when a session was revoked mid-navigation. */
export async function forceSignOut(reason: string): Promise<never> {
  await signOut({ redirect: false })
  redirect(`/login?reason=${encodeURIComponent(reason)}`)
}

// ---------------------------------------------------------------------------

async function requestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  const headerList = await headers()
  const forwarded = headerList.get('x-forwarded-for')
  return {
    // First entry only — later entries are client-supplied and forgeable.
    ip: forwarded?.split(',')[0]?.trim() || headerList.get('x-real-ip') || undefined,
    userAgent: headerList.get('user-agent') ?? undefined,
  }
}

/**
 * Open-redirect guard.
 *
 * `//evil.com` is protocol-relative and browsers treat it as absolute, so
 * checking only for a leading `/` is the classic version of this bug.
 */
function safeNext(next: string | undefined): string {
  if (!next) return '/dashboard'
  if (!next.startsWith('/')) return '/dashboard'
  if (next.startsWith('//')) return '/dashboard'
  if (next.includes('\\')) return '/dashboard'
  return next
}
