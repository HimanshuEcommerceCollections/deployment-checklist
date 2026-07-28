import { handlers } from '@/lib/auth/auth'

/**
 * Auth.js catch-all route: /api/auth/signin, /callback/credentials, /csrf,
 * /session, /signout.
 *
 * Must run on the Node runtime — the credentials provider reaches Prisma and
 * Argon2, neither of which works on the Edge.
 */
export const runtime = 'nodejs'

export const { GET, POST } = handlers
