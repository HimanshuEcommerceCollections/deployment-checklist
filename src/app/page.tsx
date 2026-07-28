import { redirect } from 'next/navigation'

/**
 * The root has no content of its own. Middleware has already decided whether a
 * session exists, so an unauthenticated visitor is bounced to /login from there
 * and this redirect only ever runs for signed-in users.
 */
export default function RootPage() {
  redirect('/dashboard')
}
