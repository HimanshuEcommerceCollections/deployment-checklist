# 8 — Abstractions

Covers deliverable **11** (email), plus the same pattern applied to the remaining external dependencies.

Every abstraction here follows one shape:

```
Application service   owns rules, permissions, database rows, audit
       │  depends on an interface, never a class
       ▼
Port (interface)      the contract — lives in src/lib/<name>/types.ts
       │
       ▼
Adapters             dumb: no permissions, no DB, no retry, no policy
```

Adapters are constructed in exactly one place, [src/server/container.ts](../src/server/container.ts). Anywhere else `new GmailSmtpProvider()` appears, the abstraction has already leaked.

---

## 1. Notifications

Code: [src/lib/notifications/types.ts](../src/lib/notifications/types.ts) · [providers/gmail.ts](../src/lib/notifications/providers/gmail.ts)

### Two layers, because Slack is not an email

The brief models Slack as a future replacement for the email provider. They are siblings. Slack has no subject line, no cc/bcc, no HTML body, no per-recipient addressing in the same sense. One interface covering both is an `EmailProvider` with half its fields permanently ignored.

```
DomainEvent  ("deployment.completed")
     │
     ▼
NotificationDispatcher              decides WHICH channels receive this event
     ├── EmailChannel ──▶ EmailProvider          ← the swappable transport
     │                     ├── GmailSmtpProvider    today
     │                     ├── SmtpProvider         any host
     │                     ├── ResendProvider       later
     │                     ├── SesProvider          later
     │                     ├── ConsoleProvider      dev — prints, never sends
     │                     └── NoopProvider         tests
     ├── SlackChannel     later
     ├── TeamsChannel     later
     └── WebhookChannel   later
```

Swapping Gmail for Resend: one `EmailProvider` implementation, one settings change. Adding Slack: one `NotificationChannel` implementation, one registry entry. Neither touches a service, a domain rule, or a database row.

### The transactional outbox

Business code **never calls a provider.** It enqueues, in the same transaction as the state change it describes:

```ts
// inside DeploymentService.completeRun
await db.$transaction(async (tx) => {
  await tx.deploymentRun.update({ where: { id }, data: { status: 'COMPLETED', completedAt: now, … } })
  await audit.record(tx, ctx, 'deployment.completed', { … })
  await notifications.enqueue({
    templateKey: 'deployment-completed',
    idempotencyKey: `run-complete:${id}`,      // unique index → duplicate enqueue is a no-op
    recipients: await this.subscribersFor(run),
    payload: { reference, project, environment, version, duration, completedBy, url },
    relatedEntityType: 'DeploymentRun',
    relatedEntityId: id,
  }, tx)
})
```

The guarantee: **either the run is complete and the notification is queued, or neither happened.** There is no window where the status changed but the email was lost, and none where an email announces a completion that was rolled back.

Everything the pattern buys, in exchange for one collection and a cron job:

| Property | How |
|---|---|
| No user-visible latency | the request returns before any SMTP handshake |
| Retries with backoff | `attempts`, `nextAttemptAt`, `maxAttempts` |
| At-most-once | `idempotencyKey` is uniquely indexed |
| Survives provider outages | rows wait; nothing is dropped |
| Inspectable | admin outbox view shows queued, failed, and sent, with the error |
| Rate-limit aware | worker respects `provider.dailyLimit` — a Gmail lockout mid-release is a real failure mode |
| Provider cutover is invisible | queued rows drain through whichever provider is configured when they run |

### The worker

```ts
// src/server/jobs/outbox-drain.ts
export async function drainOutbox({ batchSize = 25, now = new Date() } = {}) {
  return withJobLock('outbox:drain', 60_000, async () => {
    // Claim before sending. An unclaimed row processed by two concurrent
    // invocations sends the email twice, and cron platforms deliver
    // at-least-once, so overlap is expected rather than exceptional.
    const claimed = await claimBatch(batchSize, now)

    for (const row of claimed) {
      try {
        const channel = registry.forKind(row.channel)
        const result = await channel.deliver(toRequest(row))
        await markSent(row.id, result)
      } catch (error) {
        const retryable = error instanceof EmailDeliveryError ? error.options.retryable : true
        const attempts = row.attempts + 1

        if (!retryable || attempts >= row.maxAttempts) {
          await markDead(row.id, error)            // stays visible in the admin view
          logger.error({ outboxId: row.id, attempts, err: error }, 'notification dead-lettered')
        } else {
          // 1m, 2m, 4m, 8m, 16m — capped, with jitter so a provider recovering
          // from an outage does not get a synchronised thundering herd.
          const delayMs = Math.min(2 ** attempts * 60_000, 16 * 60_000)
          await scheduleRetry(row.id, new Date(now.getTime() + delayMs + jitter()), error)
        }
      }
    }
    return summarise(claimed)
  })
}
```

Dead-lettered rows are never silently discarded: they appear in the admin outbox with the provider error and a **Retry** button (`notification.retry`). A password-reset email that failed five times is something an admin must be able to see and act on.

### Templates

React Email in [emails/](../emails/), rendered to HTML **and** plain text. A transactional email with no text part is treated as spam by several filters, so the text branch is not optional.

| Template | Trigger | Recipients |
|---|---|---|
| `user-invite` | admin invites | invitee |
| `password-reset` | reset requested | requester |
| `password-changed` | password changed | account owner — the only signal of a takeover |
| `deployment-started` | → `IN_PROGRESS` | project members (opt-in) |
| `deployment-completed` | → `COMPLETED` | project members + starter |
| `deployment-failed` | → `FAILED` | project members + starter, `high` priority |
| `deployment-cancelled` | → `CANCELLED` | starter |
| `deployment-rolled-back` | → `ROLLED_BACK` | project members |
| `deployment-comment-mention` | `@user` in a comment | mentioned user |
| `template-updated` | version published | users holding `template.read` on affected projects (opt-in) |
| `test-email` | admin settings button | the requesting admin |

Templates receive **primitives, not entities.** `{ reference, projectName, environmentName, version, durationLabel, completedByName, url }`, never a Prisma model. Passing an entity leaks internal fields into an email and couples a template to the schema — the way an SMTP password ends up in a rendered footer.

### Configuration

Two environment variables sit above the provider choice, because "we do not have an email provider yet" has to be expressible without commenting out call sites.

| Variable | Values | Effect |
|---|---|---|
| `EMAIL_ENABLED` | `true` (default) \| `false` | Master switch, owned by the deployment. `false` skips delivery entirely, requires no provider credentials, and **cannot be overridden from the admin UI** — `emailConfigFromSettings` ANDs the two rather than letting settings win. |
| `EMAIL_CONFIG_SOURCE` | `settings` (default) \| `env` | Who wins on conflict. `env` ignores the `Setting` row for transport altogether. |

`EMAIL_CONFIG_SOURCE=env` exists for a specific trap: `Setting.emailProvider` defaults to `"gmail"` in [schema.prisma](../prisma/schema.prisma), so a seeded row silently outranks `EMAIL_PROVIDER=console` and the worker starts dialling Gmail with no credentials. Pinning to `env` makes the deployment authoritative.

With email off, `enqueue()` still runs inside the caller's transaction and the row keeps its payload — the worker closes it out as `SENT` with `provider: "disabled"` and a `lastError` naming the responsible switch. Nothing is lost, and every row is retryable from the admin outbox the moment a provider is configured.

Rows are closed out rather than left `PENDING` deliberately. Retrying a row that fails for *configuration* reasons just burns attempts until it dead-letters, and a queue full of policy failures is indistinguishable from a provider outage.

Below those, precedence is: database `Setting` first, environment variables as fallback. An admin can switch provider from the UI with no deploy; a fresh clone works from env alone.

```ts
export function createEmailProvider(config: EmailProviderConfig): EmailProvider {
  switch (config.provider) {
    case 'gmail':   return new GmailSmtpProvider(config)
    case 'smtp':    return new SmtpProvider(config)
    case 'resend':  return new ResendProvider(config)
    case 'ses':     return new SesProvider(config)
    case 'console': return new ConsoleProvider()     // dev default — prints, never sends
    case 'noop':    return new NoopProvider()        // tests
    default: throw new Error(`Unknown email provider: ${config.provider}`)
  }
}
```

`console` is the default in development so a fresh clone needs no Gmail account, and so nobody accidentally emails a real person from a seeded database.

### Gmail specifics that will otherwise cost you a day

All four are handled in [gmail.ts](../src/lib/notifications/providers/gmail.ts):

1. **App Password required.** 2FA must be on; the account password yields `535`. `verify()` returns that as actionable text rather than nodemailer's raw error.
2. **Gmail silently rewrites `From`** to the authenticated account unless the address is a verified alias. Setting `noreply@company.com` while authenticating as `releases@gmail.com` does not fail — it sends as the Gmail account and nobody notices until a recipient replies to a dead mailbox. `assertFromIsSendable()` refuses to construct the provider in that state.
3. **~500 recipients/day** (≈2,000 on Workspace), and the account locks when exceeded. Declared as `dailyLimit` so the worker throttles.
4. **Deliverability is not yours.** You cannot set SPF/DKIM/DMARC for `gmail.com`. Fine for a handful of internal invites; migrate to Resend or SES with a verified domain before this carries anything users must not miss.

### Turning email on for the first time

Set `EMAIL_ENABLED=true`, point `EMAIL_PROVIDER` at a real provider with its credentials, and retry the skipped rows from the admin outbox. No code change — the call sites never knew email was off.

### Migrating off Gmail

The whole point of the abstraction, in four steps: verify your domain with the new provider and publish SPF/DKIM/DMARC → add the API key in admin settings → switch `emailProvider` → send a test. Queued rows drain through the new provider automatically. No code change, no data migration, no downtime.

If `EMAIL_CONFIG_SOURCE=env`, step three is `EMAIL_PROVIDER` in the environment rather than the admin UI — the settings row is being ignored on purpose.

---

## 2. The remaining ports

Same pattern, smaller surface.

| Port | Why it is a port | Adapters |
|---|---|---|
| `Clock` | `durationMs`, rollup buckets, and token expiry are untestable against the real clock. Injecting it makes time-dependent tests deterministic instead of flaky | `systemClock`, `fixedClock(date)` |
| `IdGenerator` | snapshot ids must be reproducible in tests | `nanoIdGenerator`, `sequentialIdGenerator` |
| `RateLimiter` | in-process counters are theatre on serverless; the backend must be swappable without touching call sites | `RedisRateLimiter`, `MongoRateLimiter` |
| `Logger` | structured logs with redaction; swappable destination | `pinoLogger`, `consoleLogger`, `silentLogger` |
| `SecretBox` | AES-256-GCM today, KMS later, with no call-site change | `envKeySecretBox`, `kmsSecretBox` |
| `EventBus` | in-process now, a real queue when integrations arrive | `InProcessEventBus`, `OutboxEventBus` |
| `IntegrationProvider` | GitHub/GitLab/Jenkins/Jira are all "fetch commits, create release, link issue" | not built; interface reserved |

### Clock, concretely

```ts
export interface Clock { now(): Date }

// A test that would otherwise be unwritable
it('records duration from start to completion', async () => {
  const clock = fixedClock('2026-07-27T10:00:00Z')
  const service = new DeploymentService({ ...deps, clock })

  await service.start(ctx, runId)
  clock.advance({ minutes: 42 })
  const run = await service.complete(ctx, runId)

  expect(run.durationMs).toBe(42 * 60_000)
})
```

Without the port this test either sleeps for 42 minutes or asserts on a range and goes flaky in CI. The cost of the abstraction is an interface with one method.

### EventBus

In-process today, and deliberately so — a queue for a system with a handful of events per day is infrastructure without a payer.

```ts
export interface DomainEvent<T = unknown> { name: string; organizationId: string; payload: T; occurredAt: Date }
export interface EventBus {
  publish<T>(name: string, payload: T): Promise<void>
  subscribe<T>(name: string, handler: (event: DomainEvent<T>) => Promise<void>): void
}
```

Published from `after()` so handlers run post-response. Current subscribers: notification enqueue, stats rollup, cache invalidation. The migration path when integrations arrive is to write events to an outbox and drain them in a worker — subscriber code is unchanged, because it only ever saw the interface.

---

## 3. When *not* to abstract

Abstraction has a real cost: indirection, more files, a layer to hold in your head. It earns that cost when there is a concrete second implementation on the horizon, when the dependency is slow or non-deterministic in tests, or when it is a compliance/vendor risk.

Deliberately **not** abstracted here:

- **Prisma.** A repository interface over Prisma with only ever one implementation is ceremony. Prisma is already a data-access abstraction, and repositories are confined to `*-repository.ts` files — replaceable by rewriting those, which is the same work either way.
- **React / Next.js.** Framework-agnostic UI is a fiction with a maintenance bill.
- **Zod.** Validation schemas are the contract, not an implementation detail behind one.
- **The permission engine.** It is domain logic, not infrastructure. There is no second implementation.
- **Date formatting.** `date-fns` in a couple of helpers. Wrapping it protects against nothing.

The test: *can you name the second implementation, and would you plausibly build it?* Gmail → Resend, yes. Prisma → something else, no.
