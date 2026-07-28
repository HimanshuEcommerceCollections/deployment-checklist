/**
 * No-op stand-in for the `server-only` package.
 *
 * The real package throws on import so that server modules cannot leak into a
 * client bundle. Under vitest there is no bundle, so it is aliased to this —
 * see vitest.config.ts.
 */
export {}
