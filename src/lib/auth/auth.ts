import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { headers } from 'next/headers'

import { CredentialsSchema } from '@/features/auth/schemas/auth.schema'
import { authService } from '@/features/auth/server/auth-service'

import { authConfig } from './auth.config'

/**
 * Node-runtime Auth.js instance.
 *
 * The Credentials provider lives here, NOT in auth.config.ts, because it reaches
 * Prisma and Argon2 — neither of which can run on the Edge. `middleware.ts`
 * imports only auth.config, which keeps them out of the Edge bundle. Combining
 * the two files produces build errors that are genuinely hard to read.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      // Named `credentials` so the callback URL is /api/auth/callback/credentials.
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },

      /**
       * Returning null means "rejected" — Auth.js turns that into a generic
       * CredentialsSignin error. Deliberate: the client must not be able to
       * distinguish an unknown email from a wrong password.
       */
      async authorize(raw) {
        // CredentialsSchema, not LoginSchema: Auth.js includes its own transport
        // fields (csrfToken, callbackUrl) in this payload, which a .strict() schema
        // would reject — failing every sign-in with an opaque CredentialsSignin.
        const parsed = CredentialsSchema.safeParse(raw)
        if (!parsed.success) return null

        const requestMeta = await readRequestMeta()

        const user = await authService.authenticate({
          email: parsed.data.email,
          password: parsed.data.password,
          ip: requestMeta.ip,
          userAgent: requestMeta.userAgent,
        })

        if (!user) return null

        // These fields are read by the `jwt` callback in auth.config.ts.
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          organizationId: user.organizationId,
          sessionEpoch: user.sessionEpoch,
        }
      },
    }),
  ],
})

/**
 * Client IP and user agent for audit records.
 *
 * The first entry of x-forwarded-for is the only trustworthy one — later entries
 * are client-supplied and forgeable.
 */
async function readRequestMeta(): Promise<{ ip?: string; userAgent?: string }> {
  try {
    const headerList = await headers()
    const forwarded = headerList.get('x-forwarded-for')
    return {
      ip: forwarded?.split(',')[0]?.trim() || headerList.get('x-real-ip') || undefined,
      userAgent: headerList.get('user-agent') ?? undefined,
    }
  } catch {
    return {}
  }
}
