# 4 — Authentication

Invite-only. **No sign-up route exists** — not hidden, not permission-gated, absent. The only ways an account comes into being are an admin invite or the seed script.

Stack: Auth.js v5 (NextAuth) · Credentials provider · JWT sessions · Argon2id.

---

## 4.1 The constraint that decides the session strategy

Auth.js's Credentials provider **does not support database sessions**. This is a documented limitation, not a configuration mistake: the provider has no `linkAccount` step, so the adapter never gets a chance to persist a session row. If you want credentials login, you get JWTs.

JWTs are stateless, which conflicts with three real requirements: suspend a user immediately, invalidate sessions on password change, and apply a role change without waiting for token expiry.

### Resolution: JWT + `sessionEpoch` + two-tier verification

`User.sessionEpoch` is an integer stamped into every token at sign-in. Bump it and every existing token for that user becomes invalid at once.

```ts
// Anything that must kill sessions now:
await db.user.update({ where: { id }, data: { sessionEpoch: { increment: 1 } } })
```

Bumped on: password change or reset, suspension or deactivation, global role change, email change, and admin-forced logout.

Verification runs at two tiers, because the cost profiles differ:

| Tier | Where | Checks | DB reads |
|---|---|---|---|
| **1 — routing** | `middleware.ts` (Edge) | signature, `exp` | **0** |
| **2 — authorization** | `getRequestContext()` (Node, RSC/action/handler) | `sessionEpoch`, `status`, effective permissions | **1 per request**, memoised |

Tier 1 keeps navigation fast and never makes a security decision beyond "is there a plausible token". Tier 2 is the authority, runs before every read of protected data and every mutation, and is wrapped in React's `cache()` so a page with twelve permission checks still performs exactly one database read.

```ts
// src/server/context.ts
import { cache } from 'react'
import 'server-only'

export const getRequestContext = cache(async (): Promise<RequestContext> => {
  const session = await auth()
  if (!session?.user?.id) throw new UnauthenticatedError()

  const user = await db.user.findFirst({
    where: { id: session.user.id, deletedAt: null },
    select: {
      id: true, email: true, name: true, status: true, sessionEpoch: true,
      organizationId: true, roleIds: true, timezone: true, theme: true,
      memberships: {
        where: { deletedAt: null },
        select: { projectId: true, roleId: true },
      },
    },
  })

  if (!user) throw new UnauthenticatedError('user-removed')
  if (user.status !== 'ACTIVE') throw new UnauthenticatedError('user-inactive')
  // The revocation check. A stale token dies here, not at expiry.
  if (user.sessionEpoch !== session.sessionEpoch) throw new UnauthenticatedError('session-revoked')

  const roles = await getRolesCached(user.organizationId)   // cached; roles change rarely
  return buildContext(user, roles)                           // resolves effective permissions
})
```

An `UnauthenticatedError` surfacing in an RSC is caught by the route-group `error.tsx` and redirects to `/login?reason=session-revoked`, so a suspended user is ejected on their next interaction rather than at token expiry.

### Cookie and token settings

| Setting | Value | Source |
|---|---|---|
| Strategy | `jwt` | forced by Credentials provider |
| Idle timeout | `Setting.sessionTimeoutMinutes` (default 480) | rolling; read at config time |
| Absolute lifetime | `Setting.sessionAbsoluteHours` (default 720) | `absoluteExpiry` claim, checked in the `jwt` callback |
| Cookie | `httpOnly`, `secure` in prod, `sameSite: 'lax'` | `lax` so the email-link flows work |
| Name | `__Secure-authjs.session-token` in prod | `__Secure-` prefix |
| Secret | `AUTH_SECRET`, 32+ bytes | validated at boot |

`sameSite: 'strict'` was rejected: it breaks top-level navigation from an invite or reset email, which is the entry point for every new user. Server Actions carry Auth.js's own origin check, and the REST surface verifies `Origin` explicitly — CSRF is covered without it.

---

## 4.2 Flow: admin invites a user

```
Admin ── POST invite ──▶ InvitationService.create
                          │
                          ├─ requirePermission('user.invite')
                          ├─ Zod: email, name?, roleIds[], projectGrants[], message?
                          ├─ reject if an ACTIVE user already owns that email
                          ├─ rate limit: 20 invites / hour / actor
                          ├─ revoke any PENDING invitation for the same email
                          │
                          ├─ raw   = base64url(randomBytes(32))        ← emailed once
                          ├─ hash  = sha256(raw)                        ← stored
                          ├─ INSERT Invitation { tokenHash: hash, expiresAt: now + inviteExpiryHours,
                          │                      roleIds, projectGrants, status: PENDING }
                          ├─ UPSERT User { status: INVITED, passwordHash: null }   ← appears in admin lists
                          ├─ audit('user.invited', { targetUserId, roleIds })
                          └─ outbox.enqueue('user-invite', {
                                 idempotencyKey: `invite:${invitationId}`,
                                 acceptUrl: `${APP_URL}/accept-invite/${raw}` })
                                     │
                                     └─ cron drains → EmailChannel → GmailSmtpProvider
```

The raw token exists in memory for the duration of one request and inside one email. The database holds only its SHA-256 hash, so a database compromise does not yield usable invite links.

Why a `User` row is created at invite time with `status: INVITED`: the admin needs to see pending people in the user list, roles need somewhere to live, and `Membership` rows need a `userId`. Acceptance flips the status and sets a password hash — it does not create the user.

### Accepting

```
GET /accept-invite/[token]                       (RSC, no session required)
  hash = sha256(token)
  invitation = findUnique({ tokenHash: hash })
  ├─ not found            → "This invitation link is not valid."
  ├─ status ≠ PENDING     → "already used" / "revoked"
  ├─ expiresAt < now      → mark EXPIRED, offer "request a new invite"
  └─ valid → render the form (email shown, read-only) + name + password + confirm

POST acceptInvite (Server Action)
  ├─ re-validate the token   ← never trust the GET; the form could be replayed
  ├─ password policy from Setting: minimum length only (8 by default)
  │    Composition, blocklist, sequence and name/email checks were all removed —
  │    see src/lib/auth/password-policy.ts for the trade-off. zxcvbn is not used.
  ├─ $transaction:
  │    1. User.update  { name, passwordHash: argon2id(pw), status: ACTIVE,
  │                      passwordChangedAt: now, sessionEpoch: { increment: 1 } }
  │    2. Membership.createMany(projectGrants)
  │    3. Invitation.update { status: ACCEPTED, acceptedAt, acceptedIp, createdUserId }
  │    4. audit('user.invite_accepted')
  ├─ signIn('credentials', …)   ← straight into the app, no second login
  └─ redirect /dashboard?welcome=1
```

Re-validating inside the POST matters: the token arrives from a URL the client controls, and the GET only proved it was valid *then*.

### Resend and revoke

Resend issues a **new** token and invalidates the previous one (`sentCount++`, `lastSentAt`), rate-limited to 3 per invitation per hour. Revoke sets `status: REVOKED`; if the user never accepted, the `INVITED` user row is soft-deleted with it so the admin list stays honest.

---

## 4.3 Flow: login

```
POST /api/auth/callback/credentials
  │
  ├─ rate limit BEFORE any DB work
  │    per email:  10 / 15 min      per IP: 30 / 15 min
  │    exceeded → 429, generic message, audit('auth.rate_limited')
  │
  ├─ user = findFirst({ email: lower(email), deletedAt: null })
  │
  ├─ if (!user) → await argon2.verify(DUMMY_HASH, password); return null
  │      ↑ constant-time-ish: never let response latency reveal existence
  │
  ├─ if (lockedUntil > now)          → null + audit('auth.login_locked')
  ├─ if (status === 'INVITED')       → null + hint "check your invitation email"
  ├─ if (status !== 'ACTIVE')        → null + audit('auth.login_inactive')
  │
  ├─ ok = await argon2.verify(user.passwordHash, password)
  │
  ├─ if (!ok):
  │    failedLoginCount++
  │    if (count >= Setting.maxFailedLogins) lockedUntil = now + lockoutMinutes
  │    audit('auth.login_failed', { attempt: count })
  │    return null
  │
  └─ success:
       reset failedLoginCount, clear lockedUntil, set lastLoginAt/lastLoginIp
       audit('auth.login_succeeded')
       → jwt callback stamps { sub, orgId, sessionEpoch, absoluteExpiry }
```

Every failure path returns the same message to the client: **"Invalid email or password."** Distinguishing "no such user" from "wrong password" is a free account-enumeration oracle. The one exception is `INVITED`, where a hint to check the invitation email is worth more than the marginal enumeration risk — that account cannot be logged into anyway, and without the hint users file support tickets.

```ts
// src/lib/auth/password.ts
import { hash, verify } from '@node-rs/argon2'

// OWASP-aligned Argon2id parameters. @node-rs/argon2 ships prebuilt binaries
// that work on Vercel; the `argon2` package's native build often does not.
const OPTS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const

export const hashPassword = (plain: string) => hash(plain, OPTS)

export async function verifyPassword(stored: string | null, plain: string) {
  // Always spend the work, even with no stored hash, so timing is uninformative.
  if (!stored) { await verify(DUMMY_HASH, plain).catch(() => false); return false }
  return verify(stored, plain).catch(() => false)
}
```

---

## 4.4 Flow: forgot / reset password

```
POST /forgot-password
  ├─ rate limit: 5 / hour / email · 20 / hour / IP
  ├─ user = findFirst({ email, status: ACTIVE, deletedAt: null })
  ├─ if user:
  │    invalidate outstanding PASSWORD_RESET tokens for this user
  │    raw = randomBytes(32); INSERT AuthToken { type: PASSWORD_RESET,
  │                             tokenHash: sha256(raw),
  │                             expiresAt: now + passwordResetTtlMinute (30),
  │                             requestIp, userAgent }
  │    outbox.enqueue('password-reset', { resetUrl, expiresInMinutes, requestIp })
  │    audit('auth.password_reset_requested')
  └─ ALWAYS respond: "If that email is registered, a reset link is on its way."
        ↑ identical response and comparable latency whether or not the user exists

GET /reset-password/[token]   → validate (hash, unconsumed, unexpired) → render form
POST resetPassword
  ├─ re-validate the token
  ├─ password policy from Setting: minimum length only
  ├─ reject if identical to the current hash ("choose a different password")
  └─ $transaction:
       1. AuthToken.update { consumedAt: now }              ← single use
       2. User.update { passwordHash, passwordChangedAt,
                        sessionEpoch: { increment: 1 },      ← kills every session
                        failedLoginCount: 0, lockedUntil: null }
       3. audit('auth.password_reset_completed')
       4. outbox.enqueue('password-changed-notice')          ← tells the user if it wasn't them
  → redirect /login?reset=success
```

Three details that matter and are easy to skip: the token is single-use (`consumedAt`, not deletion, so the audit trail survives), `sessionEpoch` is bumped so an attacker holding a stolen session loses it the moment the real owner resets, and a *notification* email is sent after a successful change — the only signal a user gets that their account was taken over.

---

## 4.5 Route protection

```ts
// src/middleware.ts — Edge. Routing only. No DB, no permissions.
export default auth((req) => {
  const { pathname } = req.nextUrl
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return

  if (!req.auth) {
    const url = new URL('/login', req.nextUrl.origin)
    // Only relative paths — an absolute `next` is an open-redirect gift.
    url.searchParams.set('next', pathname + req.nextUrl.search)
    return NextResponse.redirect(url)
  }
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/auth|api/health|api/cron).*)'],
}
```

`PUBLIC_PREFIXES` = `/login`, `/forgot-password`, `/reset-password`, `/accept-invite`.

The layered defence, outermost to innermost:

| Layer | Enforces | Notes |
|---|---|---|
| `middleware.ts` | token present | UX; assume it can be bypassed |
| `(app)/layout.tsx` | `getRequestContext()` | epoch + status; ejects revoked sessions |
| `(admin)/layout.tsx` | `requirePermission('admin.access')` | one gate for the whole admin tree |
| `page.tsx` | resource-level permission + project scope | the real check |
| Service method | `requirePermission()` again | **the only layer that actually matters** |

The service-layer check is intentionally redundant. It is the one an attacker cannot route around, and it protects the service equally whether it was reached from a page, an action, a REST call, or a future integration.

### `next` parameter safety

```ts
function safeNext(next: string | null): string {
  if (!next?.startsWith('/') || next.startsWith('//')) return '/dashboard'
  return next
}
```

`//evil.com` is a protocol-relative URL that browsers treat as absolute. Checking only `startsWith('/')` is the classic open-redirect bug.

---

## 4.6 Auth.js configuration

```ts
// src/lib/auth/auth.config.ts — Edge-safe: no Prisma, no Node crypto
export const authConfig = {
  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id
        token.orgId = user.organizationId
        token.sessionEpoch = user.sessionEpoch
        token.absoluteExpiry = Date.now() + absoluteSessionMs()
      }
      // Absolute cap: rolling idle timeout must not extend a session forever.
      if (token.absoluteExpiry && Date.now() > Number(token.absoluteExpiry)) return null
      if (trigger === 'update') token.refreshedAt = Date.now()
      return token
    },
    async session({ session, token }) {
      session.user.id = token.sub!
      session.organizationId = token.orgId as string
      session.sessionEpoch = token.sessionEpoch as number
      return session
      // Deliberately NOT putting permissions in the session/JWT. A token that
      // carries permissions is a token that grants stale permissions.
    },
  },
} satisfies NextAuthConfig
```

```ts
// src/lib/auth/auth.ts — Node runtime; the credentials provider lives here
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (raw) => {
        const parsed = LoginSchema.safeParse(raw)
        if (!parsed.success) return null
        return authService.authenticate(parsed.data)   // all logic in the service
      },
    }),
  ],
})
```

The split is the standard Auth.js v5 pattern and it is load-bearing: `middleware.ts` imports only `authConfig`, keeping Prisma and Argon2 out of the Edge bundle. Putting them in one file produces build errors that are genuinely hard to read.

**Permissions are never in the token.** They are resolved per request in `getRequestContext()`. Encoding them in a JWT means a revoked permission stays live until the token expires — the exact failure mode `sessionEpoch` exists to prevent.

---

## 4.7 Additive later, with no rewrite

| Feature | Change required |
|---|---|
| SSO / OIDC (Google Workspace, Entra, Okta) | add the provider + the Prisma adapter. Database sessions become available for those users; `getRequestContext()` is unchanged because it already reads from the DB |
| TOTP MFA | `Setting.enforceMfa` exists; add `UserMfa`, and a `mfaVerified` claim checked in `getRequestContext()` |
| Passkeys / WebAuthn | Auth.js v5 has a `Passkey` provider; needs the adapter, same as SSO |
| API keys for CI/CD | `ApiKey` collection (hashed, scoped, expiring); a bearer-token branch in `getRequestContext()` returning `actorType: 'api-key'`. Everything downstream already accepts a non-user actor |
| Session list / remote sign-out | needs server-side session state — arrives with the adapter; until then `sessionEpoch` is the blunt instrument |
| Device trust, IP allowlist | `getRequestContext()` is the single choke point |
