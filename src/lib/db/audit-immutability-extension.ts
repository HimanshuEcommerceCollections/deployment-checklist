import { Prisma } from '@prisma/client'

/**
 * Audit logs are append-only.
 *
 * This extension is the DEVELOPMENT-time guard: it turns an accidental
 * `db.auditLog.update(...)` into a loud error on the pull request rather than a
 * silent history rewrite. In production the real guarantee is the database
 * grant — the runtime user has insert and find on `audit_logs` and nothing else
 * (docs/12 §12.8).
 *
 * Both layers, deliberately. The extension catches mistakes early and explains
 * why; the grant makes the property true even if someone removes the extension.
 */
const FORBIDDEN_OPERATIONS = new Set([
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
])

class AuditImmutabilityError extends Error {
  constructor(operation: string) {
    super(
      `AuditLog is append-only — "${operation}" is not permitted. Audit history is a record of ` +
        `what happened; correcting it would defeat its purpose. If a log entry is wrong, write a ` +
        `new entry that says so. (Archival deletion goes through the audit:archive job, which ` +
        `uses a raw command deliberately outside this guard.)`,
    )
    this.name = 'AuditImmutabilityError'
  }
}

export const auditImmutabilityExtension = Prisma.defineExtension({
  name: 'audit-immutability',
  query: {
    auditLog: {
      async $allOperations({ operation, args, query }) {
        if (FORBIDDEN_OPERATIONS.has(operation)) {
          throw new AuditImmutabilityError(operation)
        }
        return query(args)
      },
    },
  },
})

export { AuditImmutabilityError }
