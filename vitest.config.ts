import { resolve } from 'node:path'

import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    globals: false,
    setupFiles: ['tests/setup.ts'],
    // Integration tests share one database, so parallel files would race on
    // fixtures. Unit tests are pure and unaffected either way.
    fileParallelism: false,
    testTimeout: 20_000,
    include: ['tests/**/*.test.ts'],
    alias: {
      /**
       * `server-only` throws when imported outside a React Server Component
       * bundle, which is the whole point of the package — but it means any
       * server module is untestable under plain Node. Aliasing it to a no-op is
       * the standard workaround.
       */
      'server-only': resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
    },
  },
})
