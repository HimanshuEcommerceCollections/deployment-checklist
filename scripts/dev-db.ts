/**
 * Local MongoDB replica set with no installation and no Docker.
 *
 * Prisma's interactive transactions require a replica set, and this system's
 * entire write path depends on them. That normally means Docker or a local
 * mongod install. `mongodb-memory-server` downloads a real mongod binary once
 * and can run it as a single-node replica set — which is exactly what we need,
 * and it works on a machine with neither.
 *
 *   npm run dev:db          keeps running; leave it in its own terminal
 *
 * Data persists in .mongo/data between restarts, so a seeded database survives
 * a restart of this script. Delete that directory for a clean slate (or run
 * `npm run db:reset`).
 *
 * For production use MongoDB Atlas — see .env.example.
 */
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { MongoMemoryReplSet } from 'mongodb-memory-server'

const PORT = Number(process.env.DEV_DB_PORT ?? 27017)
const DB_NAME = process.env.DEV_DB_NAME ?? 'deployment_checklist'
const DATA_DIR = resolve(process.cwd(), '.mongo/data')

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  console.log('Starting MongoDB single-node replica set…')
  console.log('(first run downloads a mongod binary — this can take a minute)\n')

  const replSet = await MongoMemoryReplSet.create({
    replSet: { name: 'rs0', count: 1, storageEngine: 'wiredTiger' },
    instanceOpts: [
      {
        port: PORT,
        // Persist to disk so a seeded database survives a restart of this script.
        dbPath: DATA_DIR,
        storageEngine: 'wiredTiger',
      },
    ],
  })

  // The generated URI carries the full replica-set config; we rewrite it into
  // the form the app expects so DATABASE_URL can be copied verbatim.
  const uri = `mongodb://127.0.0.1:${PORT}/${DB_NAME}?replicaSet=rs0&directConnection=true`

  console.log('─'.repeat(72))
  console.log('  MongoDB is ready.\n')
  console.log('  DATABASE_URL="' + uri + '"\n')
  console.log('  Put that in .env.local, then in another terminal:')
  console.log('      npm run setup      (db push + data migrations + seed)')
  console.log('      npm run dev')
  console.log('─'.repeat(72))
  console.log('\nLeave this process running. Ctrl-C to stop.\n')

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received — stopping MongoDB…`)
    await replSet.stop({ doCleanup: false, force: false })
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  // Hold the process open.
  await new Promise(() => {})
}

main().catch((error) => {
  console.error('\nFailed to start MongoDB:\n')
  console.error(error)
  console.error(
    '\nAlternatives:\n' +
      '  • MongoDB Atlas free tier (M0 is already a replica set) — see .env.example\n' +
      '  • Docker: docker compose up -d\n',
  )
  process.exit(1)
})
