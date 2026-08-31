/**
 * One-off: copy every collection from SOURCE_DATABASE_URL to DATABASE_URL.
 *
 * Uses two PrismaClients rather than mongodump or the raw driver — the raw
 * `mongodb` driver cannot resolve these Atlas SRV hosts from this machine,
 * while Prisma's engine can (see memory: reference-atlas-srv-dns).
 *
 * Copies scalar + embedded fields for every model in the schema, including
 * `data_migrations`, so the migration ledger travels with the data it
 * describes. Refuses to write into a collection that already has documents,
 * so re-running after a partial failure never duplicates rows.
 */
import './load-env'

import { PrismaClient, Prisma } from '@prisma/client'

const sourceUrl = process.env.SOURCE_DATABASE_URL
if (!sourceUrl) {
  console.error('Set SOURCE_DATABASE_URL to the cluster to copy FROM.')
  process.exit(1)
}

const source = new PrismaClient({ datasourceUrl: sourceUrl })
const target = new PrismaClient() // DATABASE_URL — the new cluster

const BATCH = 500

async function run() {
  const models = Prisma.dmmf.datamodel.models

  console.log(`\nCopying ${models.length} collections…\n`)
  let totalCopied = 0

  for (const model of models) {
    const delegateName = model.name.charAt(0).toLowerCase() + model.name.slice(1)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = (source as any)[delegateName]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dst = (target as any)[delegateName]

    const rows: Record<string, unknown>[] = await src.findMany()
    const already: number = await dst.count()

    if (already > 0) {
      console.log(`  • ${model.name}: target already has ${already} rows — skipped`)
      continue
    }
    if (rows.length === 0) {
      console.log(`  • ${model.name}: empty`)
      continue
    }

    for (let i = 0; i < rows.length; i += BATCH) {
      await dst.createMany({ data: rows.slice(i, i + BATCH) })
    }

    const copied: number = await dst.count()
    const ok = copied === rows.length ? '✓' : `✗ MISMATCH (source ${rows.length})`
    console.log(`  ${ok} ${model.name}: ${copied} rows`)
    if (copied !== rows.length) process.exitCode = 1
    totalCopied += copied
  }

  console.log(`\nDone — ${totalCopied} documents copied.\n`)
}

run()
  .catch((error) => {
    console.error('\nCopy failed:\n')
    console.error(error)
    process.exit(1)
  })
  .finally(() => {
    void source.$disconnect()
    void target.$disconnect()
  })
