import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import { authConfig } from '@/lib/auth/auth.config'

/**
 * Edge middleware — Tier 1 of two-tier verification (docs/04 §4.1).
 *
 * Does ONE thing: checks that a well-signed, unexpired token is present, and
 * redirects to /login if not. It makes no authorization decision and reads no
 * database.
 *
 * Assume this layer can be bypassed. The real checks are `getRequestContext()`
 * (which validates sessionEpoch and user status against the database) and the
 * `requirePermission()` call in every service method. This exists for navigation
 * UX, not security.
 *
 * Imports only `authConfig`, never `auth.ts` — that would pull Prisma and Argon2
 * into the Edge bundle and fail the build.
 */
const { auth } = NextAuth(authConfig)

const PUBLIC_PREFIXES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/accept-invite',
]

export default auth((req) => {
  const { pathname, search } = req.nextUrl

  const isPublic = PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )

  // Signed in and heading for a login page → send them somewhere useful.
  if (isPublic && req.auth) {
    if (pathname === '/login') {
      return NextResponse.redirect(new URL('/dashboard', req.nextUrl.origin))
    }
    // Reset and accept-invite stay reachable while signed in: a user may be
    // completing a reset in another tab, and blocking it is confusing.
    return NextResponse.next()
  }

  if (isPublic) return NextResponse.next()

  if (!req.auth) {
    const loginUrl = new URL('/login', req.nextUrl.origin)
    // Relative path only. An absolute `next` would make this an open redirect.
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
})

export const config = {
  matcher: [
    /**
     * Everything except static assets, Auth.js's own routes, health checks and
     * cron. Cron is excluded because it authenticates with CRON_SECRET, not a
     * session — running it through session middleware would 302 every job.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|api/auth|api/health|api/ready|api/cron).*)',
  ],
}
