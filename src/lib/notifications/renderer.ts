import 'server-only'

import type { EmailRenderer, NotificationTemplateKey, RenderedEmail } from './types'

/**
 * Transactional email renderer.
 *
 * Hand-rolled inline-styled HTML rather than a component library. Email HTML is
 * constrained to tables and inline styles regardless of how it is authored, so
 * for five templates a component framework buys ergonomics that do not pay for
 * ~20 dependencies. It sits behind the `EmailRenderer` port, so swapping in
 * React Email later touches this file and nothing else.
 *
 * Every template returns BOTH html and text. A transactional email with no text
 * part is treated as spam by several filters, so the text branch is not optional.
 */

interface Branding {
  companyName: string
  appUrl: string
  supportEmail?: string
  primaryColor: string
}

const DEFAULT_BRANDING: Branding = {
  companyName: 'Deployment Checklist',
  appUrl: 'http://localhost:3000',
  primaryColor: '#1a7f9c',
}

/**
 * HTML-escape every interpolated value.
 *
 * A user-supplied display name or release note containing `<` would otherwise
 * break the markup — and an invite "personal message" is attacker-influenced
 * text arriving in someone else's inbox.
 */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
//  Layout
// ---------------------------------------------------------------------------

function layout(branding: Branding, content: string, preheader: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(branding.companyName)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#16202e;">
<!-- Preheader: the grey preview text next to the subject in most clients. -->
<div style="display:none;font-size:1px;color:#f4f6f9;max-height:0;overflow:hidden;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:32px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dde3ec;border-radius:12px;overflow:hidden;">
    <tr><td style="padding:24px 32px 0;">
      <div style="font-family:ui-monospace,Consolas,monospace;font-size:11px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:${esc(branding.primaryColor)};">// ${esc(branding.companyName)}</div>
    </td></tr>
    <tr><td style="padding:16px 32px 32px;">
${content}
    </td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="padding:20px 32px;text-align:center;font-size:12px;line-height:1.6;color:#5a6779;">
      Sent by ${esc(branding.companyName)}.${
        branding.supportEmail
          ? ` Questions? <a href="mailto:${esc(branding.supportEmail)}" style="color:${esc(branding.primaryColor)};">${esc(branding.supportEmail)}</a>`
          : ''
      }
      <br>This is an automated message — please do not reply.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:600;color:#16202e;">${esc(text)}</h1>`
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#16202e;">${html}</p>`
}

function muted(html: string): string {
  return `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#5a6779;">${html}</p>`
}

/**
 * Table-based button. `<a>` with padding renders inconsistently in Outlook,
 * which is why transactional email still uses tables in 2026.
 */
function button(branding: Branding, label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr><td style="border-radius:8px;background:${esc(branding.primaryColor)};">
    <a href="${esc(url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(label)}</a>
  </td></tr></table>`
}

/** Plain-text fallback for the same URL, since many clients strip buttons. */
function urlFallback(url: string): string {
  return muted(
    `If the button does not work, copy this link into your browser:<br><span style="word-break:break-all;color:#16202e;">${esc(url)}</span>`,
  )
}

function detailRows(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border:1px solid #dde3ec;border-radius:8px;background:#f9fafc;">
${rows
  .map(
    ([label, value]) => `  <tr>
    <td style="padding:8px 14px;font-size:13px;color:#5a6779;width:38%;">${esc(label)}</td>
    <td style="padding:8px 14px;font-size:13px;font-weight:600;color:#16202e;font-family:ui-monospace,Consolas,monospace;">${esc(value)}</td>
  </tr>`,
  )
  .join('\n')}
</table>`
}

// ---------------------------------------------------------------------------
//  Templates
// ---------------------------------------------------------------------------

type TemplateFn = (payload: Record<string, unknown>, branding: Branding) => RenderedEmail

const templates: Record<NotificationTemplateKey, TemplateFn> = {
  'user-invite': (p, b) => {
    const url = String(p.acceptUrl)
    const inviterName = String(p.inviterName ?? 'An administrator')
    const roleNames = Array.isArray(p.roleNames) ? (p.roleNames as string[]).join(', ') : '—'
    const expiresInHours = Number(p.expiresInHours ?? 72)
    const message = p.message ? String(p.message) : null

    return {
      subject: `${inviterName} invited you to ${b.companyName}`,
      html: layout(
        b,
        heading(`You have been invited to ${b.companyName}`) +
          paragraph(`${esc(inviterName)} has invited you to join <strong>${esc(b.companyName)}</strong>, where the team tracks pre-deployment checklists and release history.`) +
          detailRows([
            ['Your email', String(p.email)],
            ['Role', roleNames],
            ['Link expires in', `${expiresInHours} hours`],
          ]) +
          (message
            ? `<div style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${esc(b.primaryColor)};background:#f9fafc;font-size:14px;line-height:1.6;color:#16202e;"><em>${esc(message)}</em></div>`
            : '') +
          paragraph('Set your password to get started:') +
          button(b, 'Accept invitation', url) +
          urlFallback(url) +
          muted(
            `This invitation is single-use and expires in ${expiresInHours} hours. If you were not expecting it, you can ignore this email — no account is created until you accept.`,
          ),
        `${inviterName} invited you to join ${b.companyName}`,
      ),
      text: [
        `You have been invited to ${b.companyName}`,
        '',
        `${inviterName} has invited you to join ${b.companyName}.`,
        '',
        `Email: ${p.email}`,
        `Role:  ${roleNames}`,
        ...(message ? ['', `Message from ${inviterName}:`, `  "${message}"`] : []),
        '',
        'Accept your invitation and set a password:',
        url,
        '',
        `This link is single-use and expires in ${expiresInHours} hours.`,
        'If you were not expecting this, you can ignore it — no account is created until you accept.',
      ].join('\n'),
    }
  },

  'password-reset': (p, b) => {
    const url = String(p.resetUrl)
    const minutes = Number(p.expiresInMinutes ?? 30)

    return {
      subject: `Reset your ${b.companyName} password`,
      html: layout(
        b,
        heading('Reset your password') +
          paragraph(`We received a request to reset the password for <strong>${esc(p.email)}</strong>.`) +
          button(b, 'Choose a new password', url) +
          urlFallback(url) +
          muted(`This link expires in ${minutes} minutes and can only be used once.`) +
          muted(
            `<strong>If you did not request this</strong>, you can safely ignore this email — your password will not change. ${
              p.requestIp ? `The request came from ${esc(p.requestIp)}.` : ''
            }`,
          ),
        'Reset your password',
      ),
      text: [
        'Reset your password',
        '',
        `We received a request to reset the password for ${p.email}.`,
        '',
        'Choose a new password:',
        url,
        '',
        `This link expires in ${minutes} minutes and can only be used once.`,
        '',
        'If you did not request this, ignore this email — your password will not change.',
        ...(p.requestIp ? [`The request came from ${p.requestIp}.`] : []),
      ].join('\n'),
    }
  },

  /**
   * Sent after every password change. Often the ONLY signal a user gets that
   * their account was taken over, which is why it is not optional or opt-out.
   */
  'password-changed': (p, b) => ({
    subject: `Your ${b.companyName} password was changed`,
    html: layout(
      b,
      heading('Your password was changed') +
        paragraph(`The password for <strong>${esc(p.email)}</strong> was just changed.`) +
        detailRows([
          ['When', String(p.changedAt)],
          ...((p.ip ? [['From IP', String(p.ip)]] : []) as Array<[string, string]>),
        ]) +
        paragraph(
          `<strong>If this was not you</strong>, contact an administrator immediately${
            b.supportEmail ? ` at <a href="mailto:${esc(b.supportEmail)}">${esc(b.supportEmail)}</a>` : ''
          }. All existing sessions have been signed out.`,
        ),
      'Your password was changed',
    ),
    text: [
      'Your password was changed',
      '',
      `The password for ${p.email} was just changed at ${p.changedAt}.`,
      ...(p.ip ? [`From IP: ${p.ip}`] : []),
      '',
      'If this was not you, contact an administrator immediately.',
      'All existing sessions have been signed out.',
    ].join('\n'),
  }),

  'deployment-started': (p, b) => deploymentEmail(p, b, {
    verb: 'started',
    heading: `Deployment ${String(p.reference)} started`,
    accent: b.primaryColor,
  }),

  'deployment-completed': (p, b) => deploymentEmail(p, b, {
    verb: 'completed',
    heading: `Deployment ${String(p.reference)} completed`,
    accent: '#1f9d68',
  }),

  'deployment-failed': (p, b) => deploymentEmail(p, b, {
    verb: 'failed',
    heading: `Deployment ${String(p.reference)} failed`,
    accent: '#d1354a',
  }),

  'deployment-cancelled': (p, b) => deploymentEmail(p, b, {
    verb: 'cancelled',
    heading: `Deployment ${String(p.reference)} cancelled`,
    accent: '#5a6779',
  }),

  'deployment-rolled-back': (p, b) => deploymentEmail(p, b, {
    verb: 'rolled back',
    heading: `Deployment ${String(p.reference)} rolled back`,
    accent: '#b57d18',
  }),

  'deployment-comment-mention': (p, b) => {
    const url = String(p.url)
    return {
      subject: `${String(p.authorName)} mentioned you on ${String(p.reference)}`,
      html: layout(
        b,
        heading(`${String(p.authorName)} mentioned you`) +
          detailRows([
            ['Deployment', String(p.reference)],
            ['Project', String(p.projectName)],
          ]) +
          `<div style="margin:0 0 20px;padding:12px 16px;border-left:3px solid ${esc(b.primaryColor)};background:#f9fafc;font-size:14px;line-height:1.6;">${esc(p.excerpt)}</div>` +
          button(b, 'View the discussion', url) +
          urlFallback(url),
        `${String(p.authorName)} mentioned you on ${String(p.reference)}`,
      ),
      text: [
        `${p.authorName} mentioned you on ${p.reference} (${p.projectName})`,
        '',
        `"${p.excerpt}"`,
        '',
        url,
      ].join('\n'),
    }
  },

  'template-updated': (p, b) => {
    const url = String(p.url)
    return {
      subject: `Checklist template updated: ${String(p.templateName)} v${String(p.version)}`,
      html: layout(
        b,
        heading(`${String(p.templateName)} v${String(p.version)} published`) +
          paragraph(
            `${esc(p.publishedByName)} published a new version of this checklist template. ` +
              `<strong>Deployments already in progress are unaffected</strong> — they keep the checklist they started with.`,
          ) +
          detailRows([
            ['Template', String(p.templateName)],
            ['New version', `v${String(p.version)}`],
            ['Items', String(p.itemCount)],
            ...((p.changeNote ? [['Note', String(p.changeNote)]] : []) as Array<[string, string]>),
          ]) +
          button(b, 'View the template', url) +
          urlFallback(url),
        `${String(p.templateName)} v${String(p.version)} published`,
      ),
      text: [
        `${p.templateName} v${p.version} published`,
        '',
        `${p.publishedByName} published a new version of this checklist template.`,
        'Deployments already in progress are unaffected — they keep the checklist they started with.',
        '',
        `Items: ${p.itemCount}`,
        ...(p.changeNote ? [`Note: ${p.changeNote}`] : []),
        '',
        url,
      ].join('\n'),
    }
  },

  'test-email': (_p, b) => ({
    subject: `${b.companyName} — test email`,
    html: layout(
      b,
      heading('Email is working') +
        paragraph('If you are reading this, your email provider is configured correctly.') +
        muted('Sent from Admin → Settings → Email.'),
      'Email is working',
    ),
    text: [
      'Email is working',
      '',
      'If you are reading this, your email provider is configured correctly.',
      'Sent from Admin → Settings → Email.',
    ].join('\n'),
  }),
}

/** Shared body for the five deployment lifecycle notifications. */
function deploymentEmail(
  p: Record<string, unknown>,
  b: Branding,
  opts: { verb: string; heading: string; accent: string },
): RenderedEmail {
  const url = String(p.url)
  const rows: Array<[string, string]> = [
    ['Project', String(p.projectName)],
    ['Version', String(p.version)],
    ['Environment', String(p.environmentName)],
    ['Checklist', `${String(p.completedItems)}/${String(p.totalItems)} complete`],
  ]
  if (p.durationLabel) rows.push(['Duration', String(p.durationLabel)])
  if (p.actorName) rows.push([capitalise(opts.verb) + ' by', String(p.actorName)])
  if (p.reason) rows.push(['Reason', String(p.reason)])

  const brandingWithAccent: Branding = { ...b, primaryColor: opts.accent }

  return {
    subject: `${String(p.reference)} ${opts.verb} — ${String(p.projectName)} ${String(p.version)} (${String(p.environmentName)})`,
    html: layout(
      brandingWithAccent,
      heading(opts.heading) + detailRows(rows) + button(brandingWithAccent, 'View deployment', url) + urlFallback(url),
      `${String(p.reference)} ${opts.verb}`,
    ),
    text: [
      opts.heading,
      '',
      ...rows.map(([label, value]) => `${label.padEnd(16)} ${value}`),
      '',
      url,
    ].join('\n'),
  }
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// ---------------------------------------------------------------------------
//  Port implementation
// ---------------------------------------------------------------------------

export class HtmlEmailRenderer implements EmailRenderer {
  constructor(private readonly branding: Partial<Branding> = {}) {}

  async render(key: NotificationTemplateKey, payload: unknown): Promise<RenderedEmail> {
    const template = templates[key]
    if (!template) throw new Error(`Unknown email template: ${key}`)

    return template((payload ?? {}) as Record<string, unknown>, {
      ...DEFAULT_BRANDING,
      ...this.branding,
    })
  }
}

export { templates as emailTemplates }
