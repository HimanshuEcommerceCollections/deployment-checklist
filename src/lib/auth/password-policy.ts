/**
 * Password policy.
 *
 * Length plus a blocklist, not composition rules. Mandatory-symbol policies
 * reliably produce `Password1!` at scale, which is in every wordlist — length
 * and rejecting known-common passwords buys far more real resistance.
 *
 * Pure (no server-only import) so the same rules run in the browser for live
 * feedback and on the server for enforcement. The server is still the authority.
 */

export interface PasswordPolicy {
  minLength: number
  requireMixed: boolean
}

export const DEFAULT_POLICY: PasswordPolicy = { minLength: 12, requireMixed: true }

/**
 * Passwords refused regardless of length.
 *
 * A deliberately short list covering what people actually pick for an internal
 * tool. A full 10k-entry list belongs in a dedicated package if this ever faces
 * the public internet; for an invite-only system the marginal value is low and
 * the bundle cost is not.
 */
const BLOCKLIST = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  'qwerty', 'qwerty123', 'letmein', 'welcome', 'welcome1', 'admin', 'admin123',
  'changeme', 'iloveyou', 'monkey', 'dragon', 'sunshine', 'princess',
  '12345678', '123456789', '1234567890', '11111111', '00000000',
  'abc12345', 'football', 'baseball', 'trustno1', 'deployment', 'deploy123',
  'checklist', 'release123',
])

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong'

export interface PasswordCheck {
  ok: boolean
  strength: PasswordStrength
  /** Ordered, actionable. The first entry is what the user should fix next. */
  problems: string[]
  /** 0–100, for the strength meter. */
  score: number
}

export function checkPassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_POLICY,
  context: { email?: string; name?: string } = {},
): PasswordCheck {
  const problems: string[] = []
  const lower = password.toLowerCase()

  if (password.length < policy.minLength) {
    problems.push(`Use at least ${policy.minLength} characters.`)
  }

  if (policy.requireMixed) {
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
      problems.push('Mix upper and lower case letters.')
    }
    if (!/\d/.test(password)) {
      problems.push('Include at least one number.')
    }
  }

  if (BLOCKLIST.has(lower)) {
    problems.push('That password is too common — pick something less predictable.')
  }

  // Repeated characters and simple sequences read as long but are trivial.
  if (/^(.)\1+$/.test(password)) {
    problems.push('Avoid repeating a single character.')
  }
  if (/(?:0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf)/i.test(password)) {
    problems.push('Avoid keyboard patterns and simple sequences.')
  }

  // Personal information is the first thing an attacker tries.
  const emailLocal = context.email?.split('@')[0]?.toLowerCase()
  if (emailLocal && emailLocal.length >= 4 && lower.includes(emailLocal)) {
    problems.push('Do not include your email address.')
  }
  for (const part of (context.name ?? '').toLowerCase().split(/\s+/)) {
    if (part.length >= 4 && lower.includes(part)) {
      problems.push('Do not include your name.')
      break
    }
  }

  return { ok: problems.length === 0, problems, ...gradeStrength(password) }
}

function gradeStrength(password: string): { strength: PasswordStrength; score: number } {
  if (!password) return { strength: 'weak', score: 0 }

  // Rough entropy estimate: log2(charsetSize) * length, capped for display.
  let charset = 0
  if (/[a-z]/.test(password)) charset += 26
  if (/[A-Z]/.test(password)) charset += 26
  if (/\d/.test(password)) charset += 10
  if (/[^a-zA-Z0-9]/.test(password)) charset += 32

  const uniqueRatio = new Set(password).size / password.length
  const bits = Math.log2(Math.max(charset, 2)) * password.length * uniqueRatio

  const score = Math.min(100, Math.round((bits / 90) * 100))

  if (score < 35) return { strength: 'weak', score }
  if (score < 55) return { strength: 'fair', score }
  if (score < 75) return { strength: 'good', score }
  return { strength: 'strong', score }
}
