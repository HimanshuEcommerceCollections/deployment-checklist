import 'server-only'

import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id password hashing.
 *
 * `@node-rs/argon2` rather than the `argon2` package: it ships prebuilt
 * napi-rs binaries that work on Vercel and other serverless hosts, where
 * argon2's native build step frequently fails.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet recommendation for
 * Argon2id (m=19456 KiB, t=2, p=1). Raising memoryCost is the most effective
 * lever if you later want more work per hash.
 */
const OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const

/**
 * A real Argon2id hash of a random value, used to burn equivalent CPU when
 * there is no stored hash to check.
 *
 * Without this, "no such user" returns in ~1 ms while "wrong password" takes
 * ~50 ms, and that difference is a free account-enumeration oracle — measurable
 * over a network with enough samples.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$RdescudvJCsgt3ub+b+dWRWJTmaaJObG'

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

/**
 * Verify a password against a stored hash.
 *
 * Always performs a verification, even when `stored` is null, so response
 * latency does not reveal whether the account exists or has a password set.
 * Never throws — a malformed stored hash is a failed login, not a 500.
 */
export async function verifyPassword(stored: string | null | undefined, plain: string): Promise<boolean> {
  if (!stored) {
    await verify(DUMMY_HASH, plain).catch(() => false)
    return false
  }
  return verify(stored, plain).catch(() => false)
}
