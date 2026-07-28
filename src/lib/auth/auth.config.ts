import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe Auth.js configuration.
 *
 * This module MUST NOT import Prisma, Argon2, Nodemailer, or anything Node-only:
 * `middleware.ts` imports it and runs on the Edge runtime. The Credentials
 * provider lives in auth.ts, which is Node-only.
 *
 * Splitting the config is the standard Auth.js v5 pattern and it is load-bearing
 * here — combining them produces Edge bundling errors that are genuinely hard to
 * read.
 */

/** Idle timeout. Overridden per-org at runtime; this is the ceiling default. */
const DEFAULT_SESSION_MINUTES = 480

/** Absolute cap. A rolling idle timeout must not extend a session forever. */
const DEFAULT_ABSOLUTE_HOURS = 720

export const authConfig = {
  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    // Forced by the Credentials provider — it cannot use database sessions.
    // Revocation is handled by sessionEpoch, checked in getRequestContext().
    strategy: 'jwt',
    maxAge: DEFAULT_SESSION_MINUTES * 60,
    updateAge: 15 * 60,
  },

  // Explicit so the __Secure- prefix and SameSite policy are reviewable rather
  // than implicit. `lax` not `strict`: strict breaks top-level navigation from
  // invite and reset emails, which is how every user first arrives.
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === 'production'
        ? '__Secure-authjs.session-token'
        : 'authjs.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.sub = user.id
        token.organizationId = (user as { organizationId?: string }).organizationId
        token.sessionEpoch = (user as { sessionEpoch?: number }).sessionEpoch ?? 1
        token.absoluteExpiry = Date.now() + DEFAULT_ABSOLUTE_HOURS * 3600 * 1000
      }

      // Absolute lifetime cap. Returning null invalidates the session.
      if (token.absoluteExpiry && Date.now() > Number(token.absoluteExpiry)) {
        return null
      }

      // `update()` from the client after a profile change — re-stamp the epoch
      // so a self-initiated password change does not log the user out.
      if (trigger === 'update' && session && typeof session === 'object') {
        const next = session as { sessionEpoch?: number }
        if (typeof next.sessionEpoch === 'number') token.sessionEpoch = next.sessionEpoch
      }

      return token
    },

    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub
      session.organizationId = token.organizationId as string
      session.sessionEpoch = token.sessionEpoch as number
      return session

      // Permissions are deliberately NOT put on the session or the JWT. A token
      // carrying permissions grants stale permissions until it expires, which is
      // exactly what sessionEpoch exists to prevent. They are resolved per
      // request in getRequestContext().
    },

    authorized({ auth }) {
      return Boolean(auth?.user)
    },
  },

  // Set explicitly rather than inferred from headers, so a proxy cannot
  // influence which host Auth.js trusts.
  trustHost: true,

  providers: [], // populated in auth.ts (Node runtime)
} satisfies NextAuthConfig

export { DEFAULT_SESSION_MINUTES, DEFAULT_ABSOLUTE_HOURS }
