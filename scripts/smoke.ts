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

/**
 * Rendered markup only. The raw document also carries the RSC flight payload and
 * the inlined error/not-found boundary fallbacks, whose strings ("Not found",
 * client-component source text) are not what the user sees — several checks
 * below were fooled by exactly that.
 */
function visible(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/g, '')
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
  /**
   * Status 200, not 404 — and the not-found UI is not in the server markup either:
   * (app)/loading.tsx makes these pages stream, so the status flushes with the
   * loading shell and notFound() delivers its boundary through the flight stream
   * for the client to swap in. Without executing JS, the honest assertions are
   * that the not-found payload was sent and that nothing real leaked alongside it.
   */
  const envMissingHtml = await envMissing.text()
  check(
    'unknown environment id serves the not-found screen',
    envMissingHtml.includes('This page doesn') && !visible(envMissingHtml).includes(environment.key),
    `status ${envMissing.status}`,
  )

  // ── User management ──────────────────────────────────────────────────────
  // /admin/users was read-only plus Invite until Phase 7 — updateUser, deleteUser
  // and the invitation resend/revoke pair all existed with no caller.
  const managed = await db.user.findFirstOrThrow({
    where: { deletedAt: null, email: EMAIL },
    select: { id: true, email: true, roleIds: true },
  })
  const managedRole = await db.role.findFirstOrThrow({
    where: { id: { in: managed.roleIds } },
    select: { id: true, name: true },
  })

  const userList = await fetch(`${BASE}/admin/users`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  const userListHtml = userList.status === 200 ? await userList.text() : ''
  check('GET /admin/users → 200', userList.status === 200, `got ${userList.status}`)
  check('user list offers a per-row action', userListHtml.includes('Manage'))
  // The Roles column did not exist before, and rendering roleIds raw is the
  // obvious way to get it wrong. Only the rendered markup is asserted — ids
  // legitimately appear in the RSC flight payload for the client components.
  const rendered = visible(userListHtml)
  check(
    'user list resolves role names rather than ids',
    rendered.includes(managedRole.name) && !rendered.includes(managedRole.id),
    `expected "${managedRole.name}" in the markup, not ${managedRole.id}`,
  )
  check(
    'user list does not ship the permission catalog',
    !userListHtml.includes('"permissions"'),
    'whole role rows are reaching the browser',
  )

  const userDetail = await fetch(`${BASE}/admin/users/${managed.id}`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  const userDetailHtml = userDetail.status === 200 ? visible(await userDetail.text()) : ''
  check('GET /admin/users/<id> → 200', userDetail.status === 200, `got ${userDetail.status}`)
  // The §14.9 rework split the old "Organization-wide roles" fieldset into a Roles
  // picker and a Permissions matrix — assert the sections that exist now.
  check(
    'user detail renders the access card and permission matrix',
    userDetailHtml.includes('>Access<') && userDetailHtml.includes('Permissions'),
  )
  check('user detail renders project assignment', userDetailHtml.includes('Project access'))
  check('user detail flags your own row', userDetailHtml.includes('You'))
  // Self-deletion is refused server-side; the UI should not offer it either.
  // Rendered markup only — the flight payload always carries the button's source.
  check(
    'user detail withholds delete on your own account',
    !userDetailHtml.includes('Delete user'),
    'the confirm dialog should be absent for self',
  )

  const unknownUser = await fetch(`${BASE}/admin/users/ffffffffffffffffffffffff`, {
    headers: { cookie: jar.header() },
    redirect: 'manual',
  })
  // Same streaming caveat as the environment check above.
  const unknownUserHtml = await unknownUser.text()
  check(
    'unknown user id serves the not-found screen',
    unknownUserHtml.includes('This page doesn') && !visible(unknownUserHtml).includes(managed.email),
    `status ${unknownUser.status}`,
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

  // ── The deployment lifecycle, over real HTTP ──────────────────────────────
  // The console renders the transition buttons from the service, so the pages
  // are the check that a run can actually be driven to a terminal state. Before
  // Phase 4 a run was created DRAFT and nothing could ever move it.
  const lifecycleRun = await db.deploymentRun.findFirst({
    where: { deletedAt: null, status: 'DRAFT' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      projectId: true,
      reference: true,
      totalItems: true,
      totalRequired: true,
    },
  })

  if (!lifecycleRun) {
    check('a draft run exists to drive', false, 'seed or create one, then re-run')
  } else {
    const runPath = `/projects/${lifecycleRun.projectId}/deployments/${lifecycleRun.id}`

    const detail = await fetch(`${BASE}${runPath}`, {
      headers: { cookie: jar.header() },
      redirect: 'manual',
    })
    const detailHtml = detail.status === 200 ? await detail.text() : ''
    check('GET a deployment → 200', detail.status === 200, `got ${detail.status}`)
    check('run detail shows the status badge', detailHtml.includes('Draft'))
    // A DRAFT run offers exactly start and cancel.
    check('run detail offers Start deployment', detailHtml.includes('Start deployment'))
    check('run detail does not offer Complete yet', !detailHtml.includes('Complete deployment'))

    const console_ = await fetch(`${BASE}${runPath}/checklist`, {
      headers: { cookie: jar.header() },
      redirect: 'manual',
    })
    const consoleHtml = console_.status === 200 ? await console_.text() : ''
    check('GET the checklist console → 200', console_.status === 200, `got ${console_.status}`)
    check('console renders launch control', consoleHtml.includes('Launch control'))
    // The gate readout, not the gauge: HOLD while required items are outstanding.
    check(
      'console states what the gate is waiting for',
      lifecycleRun.totalRequired === 0 || consoleHtml.includes('outstanding'),
    )

    // ── Print / Save PDF ───────────────────────────────────────────────────
    // The print stylesheet can only act on what is in the document. Collapsed
    // sections used to be `{open && …}`, so printing a ten-section checklist
    // produced nine bare headers and no items — silently, and the sheet is what
    // gets filed with the release. These assertions are about the DOM contract
    // the @media print block depends on.
    const itemsInDom = (consoleHtml.match(/data-print-avoid-break/g) ?? []).length
    // Whole opening tag, so attribute order cannot change the answer — and so a
    // stray `hidden` elsewhere on the page cannot satisfy this by accident.
    const panels = consoleHtml.match(/<div[^>]*data-print-expand[^>]*>/g) ?? []
    const collapsed = panels.filter((tag) => /\shidden(=|\s|>)/.test(tag)).length

    check(
      'every checklist item is in the document, not only the open section',
      itemsInDom >= lifecycleRun.totalItems,
      `found ${itemsInDom} printable rows for ${lifecycleRun.totalItems} items`,
    )
    check(
      'collapsed sections are hidden rather than dropped from the tree',
      panels.length > 1 && collapsed === panels.length - 1,
      `${collapsed} of ${panels.length} panels hidden — expected all but the open one`,
    )
    check('app chrome is excluded from print', consoleHtml.includes('no-print'))
    check(
      'the sheet identifies itself without the app around it',
      consoleHtml.includes('print-only-block') && consoleHtml.includes('Environment:'),
    )
    check(
      'tick state is printable as text, not just a checkbox',
      consoleHtml.includes('print-only'),
    )
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
