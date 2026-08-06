/**
 * Prisma error discrimination, by code rather than instanceof.
 *
 * `PrismaClientKnownRequestError` is not reliably instanceof-able across the
 * client extension boundary this codebase wraps every query in, so callers match
 * on the stable error code instead.
 */

/** P2002 — a unique index rejected the write. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  )
}
