/**
 * Structured diffing and redaction for audit entries. Pure.
 *
 * `changes: [{ field, from, to }]` rather than prose, because it is queryable,
 * renderable, and diffable. A `summary` sentence is stored alongside for the
 * activity feed, but the structured form is the record.
 */

export interface AuditChange {
  field: string
  from: unknown
  to: unknown
}

/**
 * Fields matching these never have their VALUES recorded — only the fact that
 * they changed. An audit log containing an old SMTP password is a credential
 * leak with a compliance story attached.
 */
const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /password/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /credential/i,
  /private[_-]?key/i,
  /session/i,
  /cipher/i,
  /\bhash\b/i,
]

/** Bookkeeping fields that would otherwise appear as noise on every edit. */
const IGNORED_FIELDS: ReadonlySet<string> = new Set([
  'updatedAt',
  'createdAt',
  'updatedById',
  'searchText',
  'revision',
  'toggleCount',
])

const REDACTED = '«redacted»'
const TRUNCATED = '«truncated»'
const MAX_VALUE_LENGTH = 2_048

export function isSensitiveField(field: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(field))
}

/**
 * Compute the change set between a loaded entity and a patch.
 *
 * `trackedFields` restricts what is considered. Without it, a Prisma update
 * object carrying `updatedAt` and `updatedById` produces meaningless diffs on
 * every save and the real signal drowns.
 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  trackedFields?: readonly (keyof T & string)[],
): AuditChange[] {
  const fields = trackedFields ?? (Object.keys(after) as (keyof T & string)[])
  const changes: AuditChange[] = []

  for (const field of fields) {
    if (IGNORED_FIELDS.has(field)) continue
    if (!(field in after)) continue

    const from = before[field]
    const to = after[field]

    // Deep compare: roleIds, permissions and environmentKeys are ordinary array
    // fields here, and a reference comparison would report a change every save.
    if (!deepEqual(from, to)) {
      changes.push({ field, from: normalise(from), to: normalise(to) })
    }
  }

  return changes
}

/** Redact sensitive values and cap oversized ones. Applied before persistence. */
export function redactChanges(changes: readonly AuditChange[]): AuditChange[] {
  return changes.map((change) => {
    if (isSensitiveField(change.field)) {
      // Record THAT it changed. "smtpSecretRef changed" is the audit fact; the
      // old password is a liability.
      return { field: change.field, from: REDACTED, to: REDACTED }
    }
    return {
      field: change.field,
      from: capValue(change.from),
      to: capValue(change.to),
    }
  })
}

/** Redact a free-form metadata object recursively. */
export function redactObject(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 6) return {}
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (isSensitiveField(key)) {
      out[key] = REDACTED
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      out[key] = redactObject(value as Record<string, unknown>, depth + 1)
    } else {
      out[key] = capValue(value)
    }
  }

  return out
}

// ---------------------------------------------------------------------------
//  Internals
// ---------------------------------------------------------------------------

/**
 * Cap oversized values.
 *
 * A 20,000-character release-notes edit stored twice per revision would bloat
 * the fastest-growing collection in the system for no forensic gain.
 */
function capValue(value: unknown): unknown {
  if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
    return `${value.slice(0, MAX_VALUE_LENGTH)}… ${TRUNCATED}`
  }
  if (Array.isArray(value) && value.length > 100) {
    return [...value.slice(0, 100), `… ${TRUNCATED} (${value.length} total)`]
  }
  return value
}

/** Convert values into something JSON-storable and comparable. */
function normalise(value: unknown): unknown {
  if (value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return value
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return a === b

  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof Date || b instanceof Date) return false

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (Array.isArray(a) || Array.isArray(b)) return false

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object)
    const keysB = Object.keys(b as object)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    )
  }

  return false
}
