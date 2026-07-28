# 12 — Security

Threat model: an internal, invite-only tool holding release history, deployment credentials-adjacent configuration (SMTP secrets), and an audit trail that may be relied on for compliance. The realistic adversaries are a compromised employee account, a curious-but-unauthorised insider, and an attacker who has reached an authenticated session. External anonymous attack surface is small — there is no public sign-up — but everything reachable pre-auth (login, invite, reset) is disproportionately valuable.

---

## 12.1 Authentication

Covered in detail in [docs/04](04-authentication.md); the security-relevant decisions:

| Control | Implementation | Why |
|---|---|---|
| Password hashing | Argon2id via `@node-rs/argon2`, `m=19456 t=2 p=1` | OWASP-recommended parameters. `@node-rs` ships prebuilt binaries that work on serverless; the `argon2` package's native build frequently does not |
| Timing safety | `verifyPassword` always performs a hash comparison, even with no stored hash | response latency must not reveal whether an account exists |
| Enumeration | identical message on every login failure; identical response and comparable latency on forgot-password | a distinguishable response is a free account-enumeration oracle |
| Lockout | `maxFailedLogins` (10) → `lockoutMinutes` (15) | slows credential stuffing without a permanent-lockout denial-of-service |
| Rate limiting | checked **before** any DB work | a stuffing run costs an index lookup, not an Argon2 verification |
| Token storage | invite and reset tokens stored as SHA-256 hashes only | a database compromise yields no usable links |
| Token entropy | 32 random bytes from `crypto.randomBytes`, base64url | never `Math.random()`, never a UUID |
| Single use | `consumedAt` set in the same transaction as the password write | a replayed reset link fails |
| Session revocation | `sessionEpoch` bumped on password change, suspension, role change | JWTs are stateless; this is the revocation lever |
| Absolute session cap | `absoluteExpiry` claim, checked in the `jwt` callback | a rolling idle timeout must not extend a session indefinitely |
| Reset notification | `password-changed` email after every change | the only signal a user gets that their account was taken over |

**Password policy.** Length ≥ 12 from `Setting.passwordMinLength`, plus `zxcvbn` score ≥ 3. Length and a strength estimator beat composition rules — mandatory-symbol policies produce `Password1!` at scale, which is in every wordlist.

---

## 12.2 Authorization

The full design is [docs/05](05-authorization.md). The failure modes it is built against:

**Broken object-level authorization (IDOR).** Every service method authorizes with the resource's own `projectId`, resolved server-side from the loaded row, never from the request. `requirePermission(ctx, perm, { projectId: run.projectId })` — where `run` came from the database, not the body.

**Broken function-level authorization.** Every `/api/v1` route declares its permission in `withApi` config, and a static test asserts none is missing. A route with no `permission` must set `public: true` explicitly, so omission fails closed.

**Query-level leakage.** List endpoints narrow the Prisma `where` via `projectFilter`, which returns `{ projectId: { in: [] } }` — matching nothing — for an actor with no grants. Returning `{}` there would expose every row; it is the most common broken-authorization bug in applications shaped like this one, and it is handled explicitly with a test.

**Privilege escalation via role editing.** `role.manage` is `globalOnly` and `dangerous`. A role cannot grant a permission the editor does not itself hold (checked in `RoleService.update`), so a Release Manager with `role.manage` cannot mint themselves `settings.manage`. The last super-admin cannot be demoted, suspended, or deleted — otherwise an organisation can lock itself out with no recovery short of direct database access.

**Mass assignment.** Every Zod schema is `.strict()`. Stripping unknown keys silently accepts `{ status: "COMPLETED", organizationId: "<someone else's>" }`; rejecting surfaces the bug. `organizationId` is never accepted from input at all — it is injected from the request context by the tenant extension.

---

## 12.3 Input handling

### Validation

One Zod schema per operation, shared by the form, the action, and the REST route. Three non-negotiables: `.strict()` everywhere, every string `.trim()`-ed and length-capped, every id validated as ObjectId shape before it reaches Prisma.

Length caps are a denial-of-service control, not tidiness. An uncapped `releaseNotes` field accepts a 50 MB string that gets markdown-parsed, sanitised, and stored — and then re-parsed on every page view.

### NoSQL injection

Prisma parameterises everything, so the ordinary path is safe. The two ways it can still go wrong:

```ts
// NEVER — a user-controlled object reaching a filter is a query-operator injection
await db.user.findFirst({ where: { email: req.body.email } })   // body.email = { $ne: null }

// The defence, applied everywhere: validate to a primitive first
const { email } = LoginSchema.parse(req.body)   // z.string().email() → guaranteed string
```

`$runCommandRaw` and `$queryRaw` are restricted to the migration runner and the Atlas Search service, where inputs are escaped explicitly. A lint rule flags their use elsewhere.

### XSS

The markdown comment field is the one genuine XSS surface.

```ts
// src/lib/markdown/render.ts
export function renderMarkdown(raw: string): string {
  const html = marked.parse(raw, { gfm: true, breaks: true })
  return sanitizeHtml(html, {
    allowedTags: ['p','br','strong','em','del','code','pre','blockquote',
                  'ul','ol','li','a','h3','h4','h5','table','thead','tbody','tr','th','td','hr'],
    allowedAttributes: { a: ['href', 'title'] },
    // http/https/mailto only — javascript: and data: URLs are the classic bypass
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: (tagName, attribs) => ({
        tagName,
        // noopener prevents window.opener hijacking; nofollow discourages abuse
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
    },
  })
}
```

**Raw markdown is stored; HTML is produced at render time.** Storing rendered HTML means a sanitiser bug is permanent in the database and a sanitiser *improvement* cannot retroactively fix existing rows. Rendering on read means fixing the sanitiser fixes history.

Rendering happens in a Server Component, so no parser or sanitiser reaches the client bundle, and `dangerouslySetInnerHTML` appears in exactly one place in the codebase — reviewable, and covered by a test that asserts `<script>`, `javascript:` hrefs, `onerror` attributes, and `<iframe>` are all stripped.

### CSRF

Server Actions carry Auth.js's origin verification. REST routes verify `Origin` against an allowlist on every unsafe method. Cookies are `SameSite=Lax` — not `Strict`, because `Strict` breaks top-level navigation from invite and reset emails, which is the entry point for every new user. `Lax` blocks cross-site `POST`, which is the actual CSRF vector.

---

## 12.4 Secrets

**Nothing sensitive is stored in plaintext.** `Setting.smtpSecretRef` and `emailApiKeyRef` hold AES-256-GCM envelopes:

```ts
// src/lib/crypto/secret-box.ts
export function seal(plaintext: string): string {
  const iv = randomBytes(12)                      // GCM standard nonce length
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  // v1: prefix so the format can be rotated without ambiguity
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`
}
```

GCM is authenticated encryption: tampering with the ciphertext fails on decryption rather than producing garbage plaintext. The key comes from `SECRET_ENCRYPTION_KEY` (32 bytes, base64), validated at boot — a missing key must fail the build, not the first password reset at 2am. The interface is a port, so moving to AWS KMS or Vault is an adapter swap.

Secrets are **never** returned by an API. `GET /api/v1/settings` returns `smtpConfigured: true`, never a masked value — `••••••••` still leaks length. They are also redacted from audit diffs ([docs/09](09-audit-logging.md#redaction)) and from log lines by the pino serialiser.

**Environment validation at boot:**

```ts
// src/lib/config/env.ts
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url().refine((u) => u.includes('replicaSet') || u.includes('mongodb+srv'),
      'MongoDB must be a replica set — Prisma transactions require one'),
    AUTH_SECRET: z.string().min(32),
    SECRET_ENCRYPTION_KEY: z.string().refine((k) => Buffer.from(k, 'base64').length === 32,
      'Must be 32 bytes, base64-encoded. Generate: openssl rand -base64 32'),
    CRON_SECRET: z.string().min(32),
    APP_URL: z.string().url(),
    // …
  },
})
```

Fail at startup with a precise message. A misconfiguration discovered by a user is a misconfiguration that has already cost something.

---

## 12.5 HTTP headers

```ts
// next.config.ts
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' for styles only — Tailwind's runtime and Radix inject style
  // attributes. Scripts use a nonce; script-src is where XSS actually lands.
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'nonce-{NONCE}' 'strict-dynamic'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",           // clickjacking
  "form-action 'self'",               // stops a form being retargeted offsite
  "base-uri 'self'",                  // stops <base> hijacking relative URLs
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

headers: [{
  source: '/(.*)',
  headers: [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ],
}]
```

`frame-ancestors 'none'` plus `X-Frame-Options: DENY` is intentional belt-and-braces — the latter for older browsers. `nosniff` matters specifically for the attachment download route: without it a browser may sniff a mis-typed file as HTML and execute it in our origin.

---

## 12.6 File uploads

Detailed in [docs/08](08-abstractions.md#2-file-storage). The security-relevant chain:

1. **Extension blocklist** — `.exe`, `.js`, `.sh`, `.html`, `.svg`, `.xml`, and the rest, refused regardless of configuration. HTML served from our origin is stored XSS with the victim's session attached; SVG is scriptable and is the classic bypass of an "images only" allowlist.
2. **MIME allowlist** from settings.
3. **Size limit** enforced server-side — a client-side check is a hint.
4. **Magic-byte sniffing** with `file-type`. This is the authority; `Content-Type` is a value the uploader chose.
5. **Mismatch rejection** — declared ≠ detected means the object is deleted and the row refused.
6. **Path traversal** structurally impossible: `buildStorageKey` places the only user-influenced segment last, sanitised to `[A-Za-z0-9._-]`.
7. **Private by default** — no public object URLs for attachments. Every download is permission-checked and issued a short-lived signed URL (300 s) or proxied.
8. **`Content-Disposition: attachment`** plus `nosniff` on proxied streams, so even a mis-typed file cannot execute.
9. **Presign confirmation** — `head()` verifies real size and type after a direct upload. Without it, `/api/files/presign` is an open, validation-free upload endpoint.
10. **Virus scan hook** — `scanStatus` gates download; `infected` is refused.

---

## 12.7 Rate limiting and abuse

Fixed-window counters in Redis or the `RateLimit` collection. **In-process counters are not an option** — every serverless instance would enforce the limit independently, so the effective limit is N× what you configured.

| Bucket | Limit | Protects against |
|---|---|---|
| `login:<email>` | 10 / 15 min | credential stuffing on one account |
| `login:ip:<ip>` | 30 / 15 min | spraying across accounts |
| `forgot:<email>` | 5 / hour | reset-email bombing |
| `invite:<actorId>` | 20 / hour | a compromised admin mass-inviting |
| `api:write:<actorId>` | 60 / min | runaway scripts |
| `export:<actorId>` | 5 / hour | data exfiltration volume, DB load |
| `upload:<actorId>` | 30 / hour | storage exhaustion |

Auth buckets are keyed by **both** email and IP. Email-only allows a distributed attack on one account; IP-only allows one host to spray many accounts.

---

## 12.8 Audit integrity

The audit trail is a security control, so it is protected as one:

- **Append-only at the database.** The runtime DB user has `insert` and `find` on `audit_logs` and nothing else. A Prisma extension throws on `update`/`delete`, catching the mistake in development before the grant refuses it in production. Application-level immutability is a promise; the grant is a guarantee.
- **Actor identity frozen** on the row, never backfilled.
- **Secrets redacted** before persistence.
- **Retention defaults to keep-forever.** A TTL index quietly deleting audit history is a compliance incident waiting to happen.
- **Export is itself audited** as `audit.exported` — exporting the audit log is an auditable act.
- **Hash chaining is available but not enabled.** Under an adversarial-admin or SOC 2 threat model, add `previousHash` and a verifier job. It costs a serialised write per entry, so it is a deliberate opt-in rather than a speculative default.

---

## 12.9 Dependencies and supply chain

| Control | Implementation |
|---|---|
| Lockfile committed | `pnpm-lock.yaml`, `--frozen-lockfile` in CI |
| Vulnerability scanning | `pnpm audit --audit-level=high` fails the build; Dependabot weekly |
| SAST | CodeQL on every PR |
| Secret scanning | gitleaks pre-commit + GitHub secret scanning |
| Provenance | `pnpm` with `minimumReleaseAge` to blunt the window for a compromised release |
| No postinstall surprises | `enable-pre-post-scripts=false`, with an explicit allowlist |
| License check | fails on GPL/AGPL in production dependencies |

`minimumReleaseAge` is worth the friction. Most malicious package releases are caught and pulled within hours; refusing to install anything published in the last 24–48 hours removes most of that exposure for a delay nobody notices.

---

## 12.10 Logging and privacy

**Never logged:** passwords, password hashes, tokens (raw or hashed), session cookies, SMTP secrets, API keys, full request bodies on auth routes.

```ts
// src/lib/logger/redact.ts
export const redactPaths = [
  'password', 'passwordHash', 'token', 'tokenHash', 'smtpSecretRef',
  'emailApiKeyRef', 'apiKey', 'authorization', 'cookie', 'set-cookie',
  'req.headers.authorization', 'req.headers.cookie', '*.password', '*.token',
]
```

**Deliberately logged:** `requestId`, `actorId` (not email), route pattern (not the raw path — ids in log labels explode cardinality), status, duration, `orgId`.

`requestId` is the join key across the access log, the audit row, and the Sentry event. A user pastes it into a ticket and an engineer finds everything about that request.

**PII.** Names, emails, and IP addresses. IP is captured for audit (optional per your brief, enabled by default here — it is the field that answers "was that really them?"). Sentry runs with `sendDefaultPii: false` and a `beforeSend` scrubber.

**GDPR-style erasure.** A `purge` operation behind its own permission anonymises actor fields to `"Deleted user"` while **retaining the audit rows**. That balances the right to erasure against the integrity of a release record, and the purge is itself audited.

---

## 12.11 Pre-launch checklist

Ordered by consequence.

**Blocking**

- [ ] `SECRET_ENCRYPTION_KEY`, `AUTH_SECRET`, `CRON_SECRET` generated per environment; never shared or committed
- [ ] MongoDB is a replica set; Atlas network access is an allowlist, **not** `0.0.0.0/0`
- [ ] Runtime DB user is least-privilege; `audit_logs` grants are insert + find only
- [ ] TLS enforced end to end; HSTS with `preload`
- [ ] Seed admin password rotated; `SEED_ALLOW_PRODUCTION` unset
- [ ] SMTP App Password stored encrypted; `emailFromAddr` matches the authenticated account
- [ ] CSP active with a nonce and no `unsafe-eval`
- [ ] Rate limiting backed by Redis or the Mongo collection — verified across two instances
- [ ] Atlas PITR enabled **and a restore rehearsed**. An untested backup is not a backup
- [ ] `/api/cron/*` rejects requests without `CRON_SECRET`
- [ ] Error responses carry no stack traces or internal messages

**Before general availability**

- [ ] Authorization test suite green, including the empty-project-scope case
- [ ] `axe-core` clean on login, dashboard, console, history, template editor
- [ ] Dependency and secret scanning in CI
- [ ] Sentry configured with PII scrubbing and release tracking
- [ ] Runbook written: rotate secrets · restore · unlock an account · recover the last super-admin
- [ ] Alerting live on outbox depth, dead-letters, error rate, counter drift

**Worth doing within the first quarter**

- [ ] External penetration test, focused on the authorization matrix
- [ ] MFA for roles holding `settings.manage` or `role.manage`
- [ ] SSO, which removes password handling from your responsibility entirely
- [ ] Load test at 10× expected concurrency

---

## 12.12 Accepted risks

Stated explicitly, because an unstated accepted risk is indistinguishable from an oversight.

| Risk | Why accepted | Revisit when |
|---|---|---|
| No MFA at launch | invite-only, internal, small user base; SSO is the better investment | any external user, or a compliance requirement |
| Gmail SMTP deliverability | you cannot control SPF/DKIM/DMARC for gmail.com | volume grows, or an invite lands in spam and blocks someone |
| JWT sessions cannot be listed | Credentials provider forbids DB sessions; `sessionEpoch` covers revocation | SSO arrives and brings the adapter with it |
| No audit hash chain | costs a serialised write; no adversarial-admin threat today | SOC 2, or an untrusted admin |
| Deferred audit for item toggles | a crash between response and `after()` loses one tick entry | if a lost tick becomes materially significant |
| No virus scanning by default | internal uploaders; the hook exists | external uploads, or a policy requirement |
| `unsafe-inline` for styles | Tailwind and Radix inject style attributes; scripts remain nonce-only | a CSP-compatible styling approach is viable |
| Soft-deleted rows hold their unique keys | prevents ambiguous history from two projects named `Apex` | if key reuse becomes a real operational need |
