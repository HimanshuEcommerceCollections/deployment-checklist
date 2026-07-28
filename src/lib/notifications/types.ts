/**
 * Notification ports.
 *
 * ── Two layers, not one ──────────────────────────────────────────────────────
 * The brief models Slack as a future replacement for the email provider. They
 * are siblings, not variants: Slack has no subject line, no cc/bcc, no HTML
 * body, and no per-recipient addressing in the same sense. Collapsing them into
 * one interface produces an `EmailProvider` with half its fields ignored.
 *
 *   DomainEvent
 *       │
 *       ▼
 *   NotificationDispatcher            decides WHICH channels get this event
 *       ├── EmailChannel ──▶ EmailProvider   ← swappable transport
 *       │                    ├── GmailSmtpProvider   (today)
 *       │                    ├── SmtpProvider        (any host)
 *       │                    ├── ResendProvider      (later)
 *       │                    ├── SesProvider         (later)
 *       │                    ├── ConsoleProvider     (dev)
 *       │                    └── NoopProvider        (tests)
 *       ├── SlackChannel    (later)
 *       ├── TeamsChannel    (later)
 *       └── WebhookChannel  (later)
 *
 * Adding Slack is one `NotificationChannel` implementation plus a registry
 * entry. Replacing Gmail with Resend is one `EmailProvider` implementation.
 * Neither touches a service, a domain rule, or a database row.
 *
 * ── Everything goes through the outbox ───────────────────────────────────────
 * Business code never calls a provider. It enqueues to `NotificationOutbox`
 * inside the same transaction as the state change it describes, and a worker
 * drains the queue. That buys: retries with backoff, idempotency, an audit
 * trail of what was sent, no user-visible latency from an SMTP handshake, and
 * no lost email when the provider is down during a release.
 */

// ---------------------------------------------------------------------------
//  Email transport port
// ---------------------------------------------------------------------------

export interface EmailAddress {
  email: string
  name?: string
}

export interface EmailAttachment {
  filename: string
  content: Buffer | string
  contentType?: string
  /** Set for inline images referenced as cid:<contentId> in the HTML body. */
  contentId?: string
}

export interface EmailMessage {
  to: EmailAddress[]
  cc?: EmailAddress[]
  bcc?: EmailAddress[]
  from: EmailAddress
  replyTo?: EmailAddress
  subject: string
  html: string
  /** Always populated. A transactional email with no text part looks like spam. */
  text: string
  attachments?: EmailAttachment[]
  headers?: Record<string, string>
  /** Threads related notifications in the recipient's client. */
  references?: string[]
}

export interface EmailSendResult {
  /** Provider-assigned id, recorded on the outbox row for support lookups. */
  messageId: string
  provider: string
  acceptedCount: number
  rejected?: string[]
  /** Anything provider-specific worth keeping for forensics. */
  raw?: unknown
}

/**
 * Classifies a failure so the worker knows whether to retry.
 *
 * Retrying a hard bounce forever burns the sending reputation that transactional
 * email depends on, so the distinction is not cosmetic.
 */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly options: {
      /** false for 5xx SMTP / invalid address / suppressed recipient. */
      retryable: boolean
      provider: string
      /** Provider status or SMTP code, kept verbatim. */
      code?: string
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'EmailDeliveryError'
  }
}

/**
 * A concrete email transport.
 *
 * Implementations are dumb pipes: no templating, no retry, no rate limiting, no
 * database access. Those belong to the channel and the worker, which is what
 * makes providers trivially interchangeable and testable.
 */
export interface EmailProvider {
  readonly name: 'gmail' | 'smtp' | 'resend' | 'ses' | 'sendgrid' | 'postmark' | 'console' | 'noop'

  send(message: EmailMessage): Promise<EmailSendResult>

  /** Credential check for the "Send test email" button in admin settings. */
  verify?(): Promise<{ ok: boolean; detail?: string }>

  /**
   * Provider ceiling, if it has a meaningful one. Gmail SMTP is roughly 500
   * recipients/day, which the worker must respect or the account gets locked
   * mid-release.
   */
  readonly dailyLimit?: number

  /** Batch endpoint, when the provider offers one (Resend, SES). */
  sendBatch?(messages: EmailMessage[]): Promise<EmailSendResult[]>
}

// ---------------------------------------------------------------------------
//  Rendering port
// ---------------------------------------------------------------------------

/** Every template key the system can send. Payloads are validated per key. */
export type NotificationTemplateKey =
  | 'user-invite'
  | 'password-reset'
  | 'password-changed'
  | 'deployment-started'
  | 'deployment-completed'
  | 'deployment-failed'
  | 'deployment-cancelled'
  | 'deployment-rolled-back'
  | 'deployment-comment-mention'
  | 'template-updated'
  | 'test-email'

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

export interface EmailRenderer {
  render(key: NotificationTemplateKey, payload: unknown): Promise<RenderedEmail>
}

// ---------------------------------------------------------------------------
//  Channel port
// ---------------------------------------------------------------------------

export interface NotificationRecipient {
  userId?: string
  email?: string
  name?: string
  /** Channel-specific target: a Slack member id, a Teams UPN, a webhook URL. */
  channelAddress?: string
}

export interface NotificationRequest {
  templateKey: NotificationTemplateKey
  payload: Record<string, unknown>
  recipients: NotificationRecipient[]
  organizationId: string
  /**
   * Natural key for at-most-once delivery, e.g. `invite:<invitationId>` or
   * `run-complete:<runId>`. A duplicate enqueue is a no-op, so a retried
   * request cannot double-send.
   */
  idempotencyKey: string
  relatedEntityType?: string
  relatedEntityId?: string
  /** Reserved for a future user-preference matrix. */
  priority?: 'high' | 'normal' | 'low'
}

export interface NotificationDeliveryResult {
  channel: string
  delivered: number
  skipped: number
  providerMessageIds: string[]
}

/**
 * A delivery medium. One implementation per medium — not per provider.
 */
export interface NotificationChannel {
  readonly kind: 'EMAIL' | 'SLACK' | 'TEAMS' | 'WEBHOOK'

  /**
   * Can this channel handle this request right now? Checked before enqueueing,
   * so a disabled channel never leaves rows to be drained.
   *
   * Reasons to decline: the channel is off in settings, no template exists for
   * this key on this medium, or no recipient has a usable address.
   */
  supports(request: NotificationRequest): Promise<boolean>

  deliver(request: NotificationRequest): Promise<NotificationDeliveryResult>
}

// ---------------------------------------------------------------------------
//  Dispatcher port
// ---------------------------------------------------------------------------

export interface NotificationDispatcher {
  /**
   * The only method business code calls. Writes outbox rows — it does NOT send.
   *
   * Call inside the same transaction as the state change being announced. The
   * transactional-outbox guarantee is: either the deployment is marked complete
   * AND the email is queued, or neither happened. There is no window where the
   * status changed but the notification was lost.
   */
  enqueue(request: NotificationRequest, tx?: unknown): Promise<void>

  /** Worker entrypoint. Claims due rows, delivers, applies backoff. */
  drain(options?: { batchSize?: number; now?: Date }): Promise<{
    claimed: number
    sent: number
    failed: number
    dead: number
  }>

  /** Admin action for a row in FAILED or DEAD. */
  retry(outboxId: string): Promise<void>
}

// ---------------------------------------------------------------------------
//  Provider factory
// ---------------------------------------------------------------------------

export interface EmailProviderConfig {
  /**
   * Resolved from EMAIL_ENABLED and `Setting.emailEnabled` together. When false
   * the worker closes rows out as skipped and never constructs a transport, so
   * every other field here is irrelevant.
   */
  enabled: boolean
  provider: EmailProvider['name']
  fromAddress: string
  fromName?: string
  replyTo?: string
  smtp?: {
    host: string
    port: number
    secure: boolean
    username: string
    /** Decrypted at call time from Setting.smtpSecretRef. Never logged. */
    password: string
  }
  /** Decrypted at call time from Setting.emailApiKeyRef. Never logged. */
  apiKey?: string
  region?: string
  dailyCap?: number
}

/**
 * Resolves the configured transport. The single place a provider is constructed
 * — everything else depends on the interface.
 *
 * Config precedence is itself configurable, via EMAIL_CONFIG_SOURCE: `settings`
 * lets the database `Setting` row win per field so an admin can switch provider
 * from the UI with no deploy, with environment variables as the fallback for
 * bootstrap and CI; `env` ignores the settings row entirely, which is what you
 * want before a real provider exists.
 */
export type EmailProviderFactory = (config: EmailProviderConfig) => EmailProvider
