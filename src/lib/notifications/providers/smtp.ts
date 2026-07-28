import 'server-only'

import nodemailer, { type Transporter } from 'nodemailer'

import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailProvider,
  type EmailProviderConfig,
  type EmailSendResult,
} from '../types'

/**
 * Generic SMTP transport for any host.
 *
 * `GmailSmtpProvider` extends this with Gmail's specific constraints (App
 * Password, From rewriting, daily cap). Use this one for Mailgun SMTP, a
 * corporate relay, Mailpit, or anything else that speaks SMTP.
 */
export class SmtpEmailProvider implements EmailProvider {
  readonly name: EmailProvider['name'] = 'smtp'
  readonly dailyLimit?: number

  protected transporter: Transporter | null = null

  constructor(protected readonly config: EmailProviderConfig) {
    if (!config.smtp) {
      throw new Error('SMTP provider requires host, port, username and password')
    }
    this.dailyLimit = config.dailyCap
  }

  /**
   * Lazy, memoised, pooled transport.
   *
   * Pooling matters: without it every message pays a fresh TLS handshake plus
   * SMTP AUTH — roughly 300–600 ms. maxConnections is small because the outbox
   * worker is serial and most hosts throttle aggressive concurrency.
   */
  protected getTransporter(): Transporter {
    if (this.transporter) return this.transporter

    const smtp = this.config.smtp!
    this.transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: { user: smtp.username, pass: smtp.password },
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    })

    return this.transporter
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const info = await this.getTransporter().sendMail({
        from: formatAddress(message.from),
        to: message.to.map(formatAddress),
        cc: message.cc?.map(formatAddress),
        bcc: message.bcc?.map(formatAddress),
        replyTo: message.replyTo ? formatAddress(message.replyTo) : undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
          cid: a.contentId,
        })),
        headers: {
          ...message.headers,
          // Suppress vacation autoresponders; mark as transactional.
          'Auto-Submitted': 'auto-generated',
          'X-Auto-Response-Suppress': 'All',
        },
        references: message.references?.join(' '),
      })

      // A 250 with a non-empty `rejected` list is a partial success. Reporting a
      // clean send here would hide a recipient that never got the email.
      if (info.rejected?.length && !info.accepted?.length) {
        throw new EmailDeliveryError('Every recipient was rejected', {
          retryable: false,
          provider: this.name,
          code: String(info.response ?? ''),
        })
      }

      return {
        messageId: info.messageId,
        provider: this.name,
        acceptedCount: info.accepted?.length ?? 0,
        rejected: info.rejected?.map(String),
        raw: { response: info.response },
      }
    } catch (error) {
      throw this.classify(error)
    }
  }

  async verify(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.getTransporter().verify()
      return { ok: true, detail: `Connected to ${this.config.smtp!.host} as ${this.config.smtp!.username}` }
    } catch (error) {
      return { ok: false, detail: this.explainVerifyFailure(error) }
    }
  }

  protected explainVerifyFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  /**
   * Classify retryable vs permanent.
   *
   * Getting this wrong is expensive in both directions: retrying a hard bounce
   * forever damages sender reputation, and giving up on a transient 421 loses a
   * password-reset email.
   */
  protected classify(error: unknown): EmailDeliveryError {
    if (error instanceof EmailDeliveryError) return error

    const err = error as { responseCode?: number; code?: string; message?: string }
    const smtpCode = err.responseCode

    // 4xx is transient by SMTP definition (421/450/451/452 = try later).
    const transientSmtp = typeof smtpCode === 'number' && smtpCode >= 400 && smtpCode < 500
    const transientNetwork = [
      'ETIMEDOUT', 'ECONNRESET', 'ECONNECTION', 'ESOCKET', 'EDNS', 'EAI_AGAIN',
    ].includes(err.code ?? '')
    // Some hosts return rate limiting as 5xx with a 4.7.0 enhanced code — a 5xx
    // that IS worth retrying, hence inspecting the message text too.
    const rateLimited = /4\.7\.0|try again later|rate limit|too many/i.test(err.message ?? '')

    return new EmailDeliveryError(err.message ?? 'SMTP send failed', {
      retryable: transientSmtp || transientNetwork || rateLimited,
      provider: this.name,
      code: smtpCode ? String(smtpCode) : err.code,
      cause: error,
    })
  }

  /** Release pooled sockets so the process can exit cleanly. */
  async close(): Promise<void> {
    this.transporter?.close()
    this.transporter = null
  }
}

export function formatAddress(address: { email: string; name?: string }): string {
  if (!address.name) return address.email
  // Escape quotes/backslashes and strip CR/LF: an unescaped quote or a newline in
  // a display name is a header-injection vector.
  const safe = address.name.replace(/["\\]/g, '\\$&').replace(/[\r\n]/g, ' ')
  return `"${safe}" <${address.email}>`
}
