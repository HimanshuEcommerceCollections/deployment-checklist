/**
 * Test bootstrap. Loads .env so integration tests reach the local database.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

for (const file of ['.env.test', '.env.local', '.env']) {
  const path = resolve(process.cwd(), file)
  if (existsSync(path)) {
    try {
      process.loadEnvFile(path)
    } catch {
      // Ignore — a later file may supply the values.
    }
  }
}
