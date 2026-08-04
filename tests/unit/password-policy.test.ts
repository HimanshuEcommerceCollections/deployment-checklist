import { describe, expect, it } from 'vitest'

import { DEFAULT_POLICY, checkPassword } from '@/lib/auth/password-policy'

/**
 * The password policy is length and nothing else by default.
 *
 * It had no test at all, which is how a policy quietly drifts: every rule here
 * used to exist and was removed on purpose, and the point of asserting the
 * removals is that reinstating one becomes a deliberate act with a failing test
 * rather than a passing commit nobody notices.
 */

describe('the default policy', () => {
  it('is 8 characters with no composition requirement', () => {
    expect(DEFAULT_POLICY).toEqual({ minLength: 8, requireMixed: false })
  })

  it('accepts eight lowercase letters', () => {
    const result = checkPassword('lavender')

    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('refuses seven characters and says how many are needed', () => {
    const result = checkPassword('lavend')

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(['Use at least 8 characters.'])
  })

  it('honours a longer minimum from the organization settings', () => {
    expect(checkPassword('lavender', { minLength: 14, requireMixed: false }).ok).toBe(false)
    expect(checkPassword('lavenderlavender', { minLength: 14, requireMixed: false }).ok).toBe(true)
  })
})

describe('rules that were deliberately removed', () => {
  /**
   * Each of these was refused before and is accepted now. They are asserted, not
   * merely absent, so that reinstating a rule surfaces here as a failure to
   * discuss rather than a silent tightening that locks users out mid-release.
   *
   * The trade is written up in src/lib/auth/password-policy.ts.
   */
  it('accepts a password on the old common-password blocklist', () => {
    expect(checkPassword('password123').ok).toBe(true)
    expect(checkPassword('12345678').ok).toBe(true)
    expect(checkPassword('changeme').ok).toBe(true)
  })

  it('accepts a single repeated character', () => {
    expect(checkPassword('aaaaaaaa').ok).toBe(true)
  })

  it('accepts keyboard runs and sequences', () => {
    expect(checkPassword('qwertyuiop').ok).toBe(true)
    expect(checkPassword('abcdefgh').ok).toBe(true)
  })

  it('accepts a password containing the user’s own name or email', () => {
    const context = { email: 'priya.kulkarni@example.com', name: 'Priya Kulkarni' }

    expect(checkPassword('priya.kulkarni', DEFAULT_POLICY, context).ok).toBe(true)
    expect(checkPassword('Kulkarni2026', DEFAULT_POLICY, context).ok).toBe(true)
  })

  it('does not require a symbol', () => {
    expect(checkPassword('lavenderfield').ok).toBe(true)
  })
})

describe('requireMixed, when an organization opts back in', () => {
  const strict = { minLength: 8, requireMixed: true }

  it('asks for both cases and a digit', () => {
    const result = checkPassword('lavender', strict)

    expect(result.ok).toBe(false)
    expect(result.problems).toEqual([
      'Mix upper and lower case letters.',
      'Include at least one number.',
    ])
  })

  it('accepts a password that satisfies it', () => {
    expect(checkPassword('Lavender1', strict).ok).toBe(true)
  })

  it('still says nothing about symbols, sequences or the blocklist', () => {
    // Opting into mixed case must not quietly bring the deleted rules back.
    expect(checkPassword('Password1', strict).ok).toBe(true)
    expect(checkPassword('Abcd1234', strict).ok).toBe(true)
  })
})

describe('the strength meter', () => {
  it('is advisory — a weak password still passes', () => {
    const result = checkPassword('12345678')

    expect(result.ok).toBe(true)
    expect(result.strength).toBe('weak')
  })

  it('grades a longer, more varied password higher', () => {
    const weak = checkPassword('aaaaaaaa')
    const strong = checkPassword('Wm7$parachute-lantern')

    expect(strong.score).toBeGreaterThan(weak.score)
    expect(strong.strength).toBe('strong')
  })

  it('reports an empty password as weak with a zero score', () => {
    expect(checkPassword('')).toMatchObject({ strength: 'weak', score: 0 })
  })
})
