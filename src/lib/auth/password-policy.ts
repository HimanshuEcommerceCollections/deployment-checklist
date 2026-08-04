/**
 * Password policy.
 *
 * Length, and nothing else by default.
 *
 * This used to also require mixed case and a digit, reject a blocklist of common
 * passwords, refuse repeated characters and keyboard runs, and refuse anything
 * containing the user's own name or email local-part. Together those made setting
 * a password hard enough that people picked something they could not remember,
 * which pushes them towards writing it down or reusing one — so the policy was
 * relaxed deliberately, on request, to a single minimum-length rule.
 *
 * What that trades away, stated plainly so nobody has to rediscover it: `password`
 * and `12345678` are now accepted. The compensating controls already in place are
 * invite-only registration, Argon2id hashing, per-account and per-IP rate limits,
 * account lockout after repeated failures, and instant session revocation via
 * `sessionEpoch`. Those bound how fast an attacker can test guesses; they do not
 * make a guessable password safe. If this system is ever exposed beyond an
 * invited team, reinstating at least the blocklist is the cheapest thing to do —
 * it costs a user nothing, because nobody is inconvenienced by being told not to
 * use "password123".
 *
 * `requireMixed` remains as an admin toggle and is still honoured, defaulted OFF.
 * It is the one former rule that stayed configurable rather than being deleted, so
 * an organization can opt back in without a deploy.
 *
 * Pure (no server-only import) so the same rules run in the browser for live
 * feedback and on the server for enforcement. The server is still the authority.
 */

export interface PasswordPolicy {
  minLength: number
  /** Opt-in: require both cases and a digit. Off by default. */
  requireMixed: boolean
}

export const DEFAULT_POLICY: PasswordPolicy = { minLength: 8, requireMixed: false }

export type PasswordStrength = 'weak' | 'fair' | 'good' | 'strong'

export interface PasswordCheck {
  ok: boolean
  strength: PasswordStrength
  /** Ordered, actionable. The first entry is what the user should fix next. */
  problems: string[]
  /** 0–100, for the strength meter. Advisory only — it never blocks. */
  score: number
}

export function checkPassword(
  password: string,
  policy: PasswordPolicy = DEFAULT_POLICY,
  /**
   * Kept in the signature although nothing reads it any more.
   *
   * Every caller passes the user's email and name, and the parameter is what a
   * "do not use your own name" rule would need if one is ever reinstated.
   * Removing it would mean touching four call sites to add it back.
   */
  _context: { email?: string; name?: string } = {},
): PasswordCheck {
  const problems: string[] = []

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

  return { ok: problems.length === 0, problems, ...gradeStrength(password) }
}

/**
 * The strength meter is guidance, not a gate.
 *
 * It is what is left to nudge someone towards a better password now that the
 * rules do not, so it stays: a short password still reads "weak" in red, it is
 * just no longer refused.
 */
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
