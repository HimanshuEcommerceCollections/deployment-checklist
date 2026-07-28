import 'server-only'

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

import { env } from '@/lib/config/env'

// ===========================================================================
//  Random tokens
// ===========================================================================

/**
 * Cryptographically secure URL-safe token.
 *
 * 32 bytes = 256 bits of entropy, which is what invite and reset links need.
 * Never Math.random(), never a UUID — v4 UUIDs have 122 bits and, more
 * importantly, some generators are not CSPRNG-backed.
 */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

/** Short, human-friendly, unambiguous id for display (no 0/O/1/I/l). */
export function generateShortCode(length = 8): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
  const buf = randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += alphabet[buf[i]! % alphabet.length]
  return out
}

// ===========================================================================
//  Hashing (for lookup keys, not passwords — passwords use Argon2id)
// ===========================================================================

/**
 * SHA-256, hex.
 *
 * Used for invite/reset token storage: the raw token is emailed once and only
 * this hash is persisted, so a database compromise yields no usable links.
 *
 * SHA-256 rather than Argon2 is correct here: these tokens are 256-bit random
 * values, not low-entropy human input, so there is nothing to brute-force and
 * a slow hash would only add latency to every verification.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time comparison. Use for any secret comparison. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on length mismatch, which would itself leak length.
  // Hash both to a fixed width first so the comparison is always same-length.
  const hashA = createHash('sha256').update(bufA).digest()
  const hashB = createHash('sha256').update(bufB).digest()
  return timingSafeEqual(hashA, hashB)
}

/** Stable checksum for content dedupe and integrity. */
export function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex')
}

// ===========================================================================
//  Authenticated encryption at rest (SMTP password, provider API keys)
// ===========================================================================

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM standard nonce length
const VERSION = 'v1'

let keyCache: Buffer | null = null

function getKey(): Buffer {
  if (keyCache) return keyCache
  const key = Buffer.from(env.SECRET_ENCRYPTION_KEY, 'base64')
  if (key.length !== 32) {
    throw new Error('SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }
  keyCache = key
  return key
}

/**
 * Encrypt a secret for storage.
 *
 * AES-256-GCM is authenticated encryption: tampering with the ciphertext fails
 * on decryption rather than silently producing garbage plaintext that then gets
 * used as an SMTP password.
 *
 * Format: v1.<iv>.<authTag>.<ciphertext>, all base64url. The version prefix
 * means the format (or the algorithm) can be rotated without ambiguity about
 * how an existing value was produced.
 */
export function seal(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [
    VERSION,
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

/** Decrypt a sealed secret. Throws if the envelope was tampered with. */
export function open(envelope: string): string {
  const parts = envelope.split('.')
  if (parts.length !== 4) throw new Error('Malformed secret envelope')

  const [version, ivPart, tagPart, ctPart] = parts as [string, string, string, string]
  if (version !== VERSION) throw new Error(`Unsupported secret envelope version: ${version}`)

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ctPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** Non-throwing variant for read paths that must degrade rather than 500. */
export function tryOpen(envelope: string | null | undefined): string | null {
  if (!envelope) return null
  try {
    return open(envelope)
  } catch {
    return null
  }
}

/** True when the value looks like one of our envelopes rather than plaintext. */
export function isSealed(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split('.').length === 4
}
