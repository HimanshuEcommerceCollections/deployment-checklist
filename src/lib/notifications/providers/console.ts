import 'server-only'

import { logger } from '@/lib/logger'

import type { EmailMessage, EmailProvider, EmailSendResult } from '../types'

/**
 * Development provider. Prints to the terminal, never sends.
 *
 * The default in development for two reasons: a fresh clone works with no Gmail
 * account, and nobody accidentally emails a real person from seeded data.
 *
 * The action URL is printed prominently because that is the whole point during
 * development — you need to click the invite or reset link, and hunting for it
 * inside an HTML dump is miserable.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console' as const

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const recipients = message.to.map((t) => t.email).join(', ')
    const links = extractLinks(message.text)

    const banner =
      '\n' +
      '┌' + '─'.repeat(76) + '\n' +
      `│ EMAIL (console provider — not sent)\n` +
      '├' + '─'.repeat(76) + '\n' +
      `│ To:      ${recipients}\n` +
      `│ From:    ${message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}\n` +
      `│ Subject: ${message.subject}\n` +
      (links.length
        ? '├' + '─'.repeat(76) + '\n' + links.map((l) => `│ 🔗 ${l}`).join('\n') + '\n'
        : '') +
      '├' + '─'.repeat(76) + '\n' +
      message.text
        .split('\n')
        .map((line) => `│ ${line}`)
        .join('\n') +
      '\n└' + '─'.repeat(76) + '\n'

    // Written directly rather than through pino: this is developer-facing output
    // meant to be read, and JSON-encoding it would defeat the purpose.
    process.stdout.write(banner)

    logger.debug({ to: recipients, subject: message.subject }, 'console email')

    return {
      messageId: `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      provider: this.name,
      acceptedCount: message.to.length,
    }
  }

  async verify() {
    return { ok: true, detail: 'Console provider — emails are printed to the terminal, never sent.' }
  }
}

/** Pull action URLs out of the text body so they are clickable in the terminal. */
function extractLinks(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/g) ?? []
  return [...new Set(matches)]
}

/** Silent provider for tests. Records nothing, sends nothing. */
export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop' as const

  async send(message: EmailMessage): Promise<EmailSendResult> {
    return {
      messageId: `noop-${Date.now()}`,
      provider: this.name,
      acceptedCount: message.to.length,
    }
  }

  async verify() {
    return { ok: true, detail: 'Noop provider' }
  }
}
