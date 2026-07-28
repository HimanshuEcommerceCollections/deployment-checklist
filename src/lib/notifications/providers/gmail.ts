import 'server-only'

import type { EmailProvider, EmailProviderConfig } from '../types'

import { SmtpEmailProvider } from './smtp'

/**
 * Gmail SMTP — the initial provider.
 *
 * Extends the generic SMTP transport with the four Gmail-specific behaviours
 * that each cost about a day to discover the hard way:
 *
 * 1. **App Password required.** Google removed "less secure app access", so the
 *    account password yields 535. A 16-character App Password (which needs 2FA
 *    enabled) is the only option. `explainVerifyFailure` says so directly
 *    instead of surfacing nodemailer's raw error.
 *
 * 2. **Gmail rewrites the From header** to the authenticated account unless the
 *    address is a verified "Send mail as" alias. Configuring
 *    `noreply@company.com` while authenticating as `releases@gmail.com` does
 *    not fail — it silently sends as the Gmail account, and nobody notices until
 *    a recipient replies to a mailbox no one reads. `assertFromIsSendable()`
 *    refuses to construct the provider in that state.
 *
 * 3. **~500 recipients/day** on consumer accounts (~2,000 on Workspace), after
 *    which the account is temporarily locked. Declared as `dailyLimit` so the
 *    outbox worker throttles rather than tripping it mid-release.
 *
 * 4. **Deliverability is not yours.** You cannot publish SPF/DKIM/DMARC for
 *    gmail.com, so transactional mail from here lands in Promotions or Spam more
 *    often than mail from a domain you control. Fine for a handful of internal
 *    invites; migrate to Resend or SES with a verified domain before this
 *    carries anything users must not miss.
 *
 * Port 465 with implicit TLS is preferred over 587 + STARTTLS: fewer round trips
 * and no window in which a downgrade attack could strip the upgrade.
 */
export class GmailSmtpProvider extends SmtpEmailProvider {
  override readonly name: EmailProvider['name'] = 'gmail'
  override readonly dailyLimit: number

  constructor(config: EmailProviderConfig) {
    super({
      ...config,
      smtp: {
        host: config.smtp?.host || 'smtp.gmail.com',
        port: config.smtp?.port || 465,
        secure: config.smtp?.secure ?? true,
        username: config.smtp?.username ?? '',
        password: config.smtp?.password ?? '',
      },
    })

    this.dailyLimit = config.dailyCap ?? 450
    this.assertFromIsSendable()
  }

  protected override explainVerifyFailure(error: unknown): string {
    const code = (error as { responseCode?: number }).responseCode

    switch (code) {
      case 535:
        return (
          'Authentication failed. Gmail requires a 16-character App Password with 2FA enabled — ' +
          'the account password will not work. Generate one at myaccount.google.com/apppasswords.'
        )
      case 534:
        return (
          'Gmail is asking for an application-specific password. Generate one at ' +
          'myaccount.google.com/apppasswords and use it as SMTP_PASSWORD.'
        )
      case 550:
        return 'The account is blocked, or the daily sending limit has been reached.'
      default:
        return super.explainVerifyFailure(error)
    }
  }

  /**
   * Fail fast on the misconfiguration Gmail hides.
   *
   * Refusing to start is better than silently sending as the wrong address,
   * because the silent version is only discovered by a confused recipient.
   */
  private assertFromIsSendable(): void {
    const authUser = (this.config.smtp?.username ?? '').toLowerCase()
    const from = this.config.fromAddress.toLowerCase()

    if (!authUser) {
      throw new Error('Gmail provider requires SMTP_USERNAME (the Gmail account address).')
    }
    if (from === authUser) return

    const aliases = (process.env.GMAIL_VERIFIED_ALIASES ?? '')
      .split(',')
      .map((alias) => alias.trim().toLowerCase())
      .filter(Boolean)

    if (aliases.includes(from)) return

    throw new Error(
      `Gmail will rewrite the From header: configured sender "${from}" does not match the ` +
        `authenticated account "${authUser}".\n\n` +
        `Pick one:\n` +
        `  • set EMAIL_FROM_ADDRESS to "${authUser}"\n` +
        `  • add "${from}" as a verified "Send mail as" alias in Gmail, then list it in ` +
        `GMAIL_VERIFIED_ALIASES\n` +
        `  • switch to a provider that supports domain sending (Resend, SES)`,
    )
  }
}
