import type { DefaultSession } from 'next-auth'

/**
 * Auth.js type augmentation.
 *
 * Only identity and the revocation epoch live on the session. Permissions are
 * resolved per request in getRequestContext() and never travel in the token —
 * see docs/04 §4.6.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
    } & DefaultSession['user']
    organizationId: string
    sessionEpoch: number
  }

  interface User {
    id?: string
    organizationId: string
    sessionEpoch: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sub?: string
    organizationId?: string
    sessionEpoch?: number
    /** Epoch millis. Enforces the absolute session cap. */
    absoluteExpiry?: number
  }
}
