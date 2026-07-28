/**
 * Load .env files for standalone scripts.
 *
 * Three tools read environment files differently, and the mismatch costs
 * everyone an hour exactly once:
 *
 *   next          reads .env.local, then .env
 *   prisma CLI    reads .env ONLY
 *   tsx / node    reads nothing
 *
 * So `.env` is the canonical local file (Prisma's constraint decides it), and
 * this module gives tsx scripts the same view Next has. Import it FIRST, before
 * anything that reads process.env:
 *
 *   import './load-env'          // must be the first import
 *   import { PrismaClient } from '@prisma/client'
 *
 * Uses Node's built-in loader rather than the `dotenv` package — one less
 * dependency, and it is available on every Node version this project supports.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/** Later files do NOT override values already set — matching Next's precedence. */
const FILES = ['.env.local', '.env']

for (const file of FILES) {
  const path = resolve(process.cwd(), file)
  if (!existsSync(path)) continue

  try {
    process.loadEnvFile(path)
  } catch (error) {
    console.warn(`Could not load ${file}: ${(error as Error).message}`)
  }
}

if (!process.env.DATABASE_URL) {
  console.error(
    '\nDATABASE_URL is not set.\n\n' +
      '  1. cp .env.example .env\n' +
      '  2. npm run dev:db      (prints the URL to paste in)\n',
  )
  process.exit(1)
}
