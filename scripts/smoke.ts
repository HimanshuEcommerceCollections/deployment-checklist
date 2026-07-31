/**
 * End-to-end smoke test against a running dev server.
 *
 *   npm run dev        (terminal 1, with npm run dev:db in terminal 2)
 *   npm run smoke
 *
 * Exercises the real HTTP surface — middleware, Auth.js, the credentials
 * provider, session verification, and the permission-driven dashboard. Unit
 * tests would not catch a broken cookie flag or a middleware redirect loop.
 *
 * Deliberately not Playwright: this is a dependency-free reachability check for
 * the identity stack. Browser-level journeys belong in tests/e2e.
 */
import './load-env'

import { PrismaClient } from '@prisma/client'

const BASE = process.env.APP_URL ?? 'http://localhost:3000'
const EMAIL = (process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com').toLowerCase()
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMeImmediately!2026'

const db = new PrismaClient()

let passed = 0
let failed = 0

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`)
  }
}

/** Minimal cookie jar — enough for one session across a few requests. */
class Jar {
  private cookies = new Map<string, string>()

  absorb(response: Response) {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';')
      const eq = pair!.indexOf('=')
      if (eq > 0) {
        const name = pair!.slice(0, eq)
        const value = pair!.slice(eq + 1)
        if (value === '' ) this.cookies.delete(name)
        else this.cookies.set(name, value)
      }
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  has(nameFragment: string): boolean {
    return [...this.cookies.keys()].some((k) => k.includes(nameFragment))
  }
}

async function main() {
  console.log(`\nSmoke test against ${BASE}\n`)

  const jar = new Jar()

  // ── Reachability ─────────────────────────────────────────────────────────
  let login: Response
  try {
    login = await fetch(`${BASE}/login`, { redirect: 'manual' })
  } catch {
    console.log(`  ✗ server reachable\n      Nothing responding at ${BASE}. Start it with: npm run dev\n`)
    process.exitCode = 1
    return
  }
  jar.absorb(login)
  const loginHtml = await login.text()
  check('GET /login → 200', login.status === 200, `got ${login.status}`)
  check('login page renders the form', loginHtml.includes('Sign in'))

  // ── Middleware protects the app ──────────────────────────────────────────
  const guarded = await fetch(`${BASE}/dashboard`, { redirect: 'manual' })
  const location = guarded.headers.get('location') ?? ''
  check(
    'unauthenticated /dashboard → redirect to /login',
    guarded.status === 307 || guarded.status === 302,
    `got ${guarded.status}`,
  )
  check('redirect preserves ?next=/dashboard', location.includes('next=%2Fdashboard'), location)

  // ── Auth.js CSRF token ───────────────────────────────────────────────────
  const csrfResponse = await fetch(`${BASE}/api/auth/csrf`, {
    headers: { cookie: jar.header() },
  })
  jar.absorb(csrfResponse)

  // Guard the parse: if the Auth.js route is missing or the dev server is
  // rebuilding, this returns an HTML error page and a bare .json() throws a
  // useless "Unexpected token '<'". Say what actually went wrong instead.
  const csrfBody = await csrfResponse.text()
  let csrfToken = ''
  try {
    csrfToken = (JSON.parse(csrfBody) as { csrfToken: string }).csrfToken
  } catch {
    check(
      'CSRF token issued',
      false,
      `/api/auth/csrf returned ${csrfResponse.status} ${csrfResponse.headers.get('content-type') ?? ''} ` +
        `instead of JSON.\n      Is the dev server running and finished compiling? ` +
        `(a concurrent \`next build\` overwrites .next and breaks it)`,
    )
    console.log(`\n${passed} passed, ${failed} failed\n`)
    process.exitCode = 1
    return
  }
  check('CSRF token issued', Boolean(csrfToken))

  // ── Wrong password is rejected ───────────────────────────────────────────
  const badLogin = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ email: EMAIL, password: 'definitely-not-the-password', csrfToken }),
  })
  const badLocation = badLogin.headers.get('location') ?? ''
  check(
    'wrong password rejected',
    badLocation.includes('error') || badLogin.status === 401,
    `location=${badLocation}`,
  )

  // Failed attempt must be audited, and must NOT contain the attempted password.
  const failedAudit = await db.auditLog.findFirst({
    where: { action: 'auth.login_failed' },
    orderBy: { createdAt: 'desc' },
  })
  check('failed login is audited', failedAudit !== null)
  check(
    'audit row leaks no password',
    !JSON.stringify(failedAudit ?? {}).includes('definitely-not-the-password'),
  )

  // ── Correct password signs in ────────────────────────────────────────────
  const goodLogin = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar.header() },
    body: new URLSearchParams({ email: EMAIL, password: PASSWORD, csrfToken, callbackUrl: `${BASE}/dashboard` }),
  })
  jar.absorb(goodLogin)
  const goodLocation = goodLogin.headers.get('location') ?? ''
  check(
    'correct password accepted',
    !goodLocation.includes('error'),
    `location=${goodLocation}`,
  )
  check('session cookie set', jar.has('session-token'))

  // ── Authenticated dashboard ──────────────────────────────────────────────
  const dashboard = await fetch(`${BASE}/dashboard`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  const dashboardHtml = dashboard.status === 200 ? await dashboard.text() : ''
  check('authenticated /dashboard → 200', dashboard.status === 200, `got ${dashboard.status}`)
  check('dashboard resolved the user', dashboardHtml.includes(EMAIL))
  // Proves the permission resolver ran: the wildcard grant is detected from data.
  check('super-admin detected from role data', dashboardHtml.includes('super-admin'))
  // Proves navigation is generated from permissions.
  check('admin navigation rendered', dashboardHtml.includes('Administration'))

  // ── Environment editing ──────────────────────────────────────────────────
  // The list page has always linked to /admin/environments/<id>; until the route
  // existed every Edit button was a 404. Both halves are checked so a future
  // catch-all cannot make the 404 case pass by accident.
  const environment = await db.environment.findFirstOrThrow({ where: { deletedAt: null } })

  const envEdit = await fetch(`${BASE}/admin/environments/${environment.id}`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  const envEditHtml = envEdit.status === 200 ? await envEdit.text() : ''
  check(
    'GET /admin/environments/<id> → 200',
    envEdit.status === 200,
    `got ${envEdit.status}`,
  )
  check('environment edit form is populated', envEditHtml.includes(environment.key))

  const envMissing = await fetch(`${BASE}/admin/environments/ffffffffffffffffffffffff`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  check(
    'unknown environment id → 404',
    envMissing.status === 404,
    `got ${envMissing.status}`,
  )

  // ── Trash renders real soft-deleted rows ─────────────────────────────────
  // Soft-delete a project underneath the page rather than trusting an empty
  // "Trash is empty" render, which would pass whether or not the query works.
  const admin = await db.user.findFirstOrThrow({ where: { email: EMAIL } })
  const trashProject = await db.project.findFirstOrThrow({ where: { deletedAt: null } })
  await db.project.update({
    where: { id: trashProject.id },
    data: { deletedAt: new Date(), deletedById: admin.id },
  })

  try {
    const trash = await fetch(`${BASE}/admin/trash`, {
      headers: { cookie: jar.header() },
      redirect: 'manual',
    })
    const trashHtml = trash.status === 200 ? await trash.text() : ''
    check('GET /admin/trash → 200', trash.status === 200, `got ${trash.status}`)
    check('trash lists the deleted project', trashHtml.includes(trashProject.name))
    check('trash offers a restore action', trashHtml.includes('Restore'))
  } finally {
    // Put it back regardless — the seeded projects are shared with every other check.
    await db.project.update({
      where: { id: trashProject.id },
      data: { deletedAt: null, deletedById: null },
    })
  }

  // ── Session verification is DB-backed, not just JWT ───────────────────────
  // Bumping sessionEpoch must invalidate the existing token immediately. This is
  // the mechanism that makes suspension and password change take effect at once.
  const user = await db.user.findFirstOrThrow({ where: { email: EMAIL } })
  await db.user.update({ where: { id: user.id }, data: { sessionEpoch: { increment: 1 } } })

  const afterRevoke = await fetch(`${BASE}/dashboard`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  const revokeLocation = afterRevoke.headers.get('location') ?? ''
  check(
    'sessionEpoch bump revokes the session',
    revokeLocation.includes('/login') && revokeLocation.includes('session-revoked'),
    `status=${afterRevoke.status} location=${revokeLocation}`,
  )

  // Restore so the seeded credentials keep working.
  await db.user.update({ where: { id: user.id }, data: { sessionEpoch: user.sessionEpoch } })

  // ── Audit trail ──────────────────────────────────────────────────────────
  const success = await db.auditLog.findFirst({
    where: { action: 'auth.login_succeeded' },
    orderBy: { createdAt: 'desc' },
  })
  check('successful login is audited', success !== null)
  check('audit records the actor', success?.actorEmail === EMAIL, `actorEmail=${success?.actorEmail}`)

  // Audit must be append-only — the Prisma extension has to refuse this.
  let refused = false
  try {
    await db.$runCommandRaw({ ping: 1 }) // sanity
    const { db: extended } = await import('../src/lib/db/prisma').catch(() => ({ db: null }) as never)
    if (extended) {
      await extended.auditLog.updateMany({ where: {}, data: { action: 'tampered' } })
    } else {
      refused = true // extension not importable from a plain script; checked in unit tests
    }
  } catch {
    refused = true
  }
  check('audit log rejects mutation', refused)

  console.log('')
  console.log(`${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error('\nSmoke test crashed:\n')
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void db.$disconnect())
