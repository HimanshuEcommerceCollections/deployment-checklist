/**
 * Server boot hook.
 *
 * Next.js calls `register()` once at server start, before any request is served —
 * the right place for a fail-fast configuration check.
 *
 * Scope is deliberately narrow: environment validation ONLY, with no Prisma
 * import. Next compiles instrumentation as its own entry and does not apply
 * `serverExternalPackages` to it, so importing @prisma/client here drags in the
 * WASM query-engine path and fails to resolve. The database health check lives in
 * `scripts/doctor.ts` instead (run by `npm run setup`), where it executes under
 * plain tsx with no bundler involved.
 */
export async function register() {
  // The Edge runtime has no Node APIs and reads none of this configuration.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { assertEnv } = await import('@/lib/config/env')

  // Throws a formatted, multi-line report listing every invalid variable.
  // Failing here beats failing at the first password reset at 2am.
  assertEnv()
}
