/**
 * Pre-flight check.
 *
 * Verifies the things that are cheap to check now and expensive to discover
 * later. Run by `npm run setup`, and standalone whenever something looks wrong:
 *
 *   npm run doctor
 *
 * Lives here rather than in instrumentation.ts because it needs Prisma, and
 * Next's instrumentation entry cannot bundle the Prisma client.
 */
import './load-env'

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

let failures = 0
let warnings = 0

function pass(label: string, detail?: string) {
  console.log(`  ✓ ${label}${detail ? `  ${detail}` : ''}`)
}
function warn(label: string, detail: string) {
  warnings += 1
  console.log(`  ! ${label}\n      ${detail}`)
}
function fail(label: string, detail: string) {
  failures += 1
  console.log(`  ✗ ${label}\n      ${detail}`)
}

async function main() {
  console.log('\nChecking configuration…\n')

  // ── Environment ──────────────────────────────────────────────────────────
  try {
    const { assertEnv } = await import('../src/lib/config/env')
    assertEnv()
    pass('environment variables')
  } catch (error) {
    fail('environment variables', (error as Error).message.trim())
    // Nothing else can pass without config, so stop here.
    return report()
  }

  // ── Connectivity ─────────────────────────────────────────────────────────
  try {
    await db.$runCommandRaw({ ping: 1 })
    pass('database reachable')
  } catch (error) {
    fail('database reachable', (error as Error).message)
    return report()
  }

  // ── Replica set / transactions ───────────────────────────────────────────
  // The important one. Every write path in this app uses $transaction, and a
  // standalone mongod fails at the first item toggle with an error that does not
  // obviously point at the cause.
  try {
    await db.$transaction(async (tx) => {
      await tx.dataMigration.findFirst()
    })
    pass('transactions supported', '(replica set)')
  } catch (error) {
    const message = (error as Error).message
    if (/transaction|replica/i.test(message)) {
      fail(
        'transactions supported',
        'MongoDB is NOT a replica set. Prisma interactive transactions require one and\n' +
          '      every write path depends on them. Fix with ONE of:\n' +
          '        • npm run dev:db          (no install, no Docker)\n' +
          '        • docker compose up -d\n' +
          '        • MongoDB Atlas (M0 free tier is already a replica set)\n' +
          '      then set DATABASE_URL to include ?replicaSet=rs0&directConnection=true',
      )
    } else {
      fail('transactions supported', message)
    }
  }

  // ── Schema applied ───────────────────────────────────────────────────────
  try {
    const count = await db.permissionDefinition.count()
    if (count === 0) {
      warn('schema seeded', 'No permission definitions found. Run: npm run db:seed')
    } else {
      pass('schema seeded', `(${count} permissions)`)
    }
  } catch {
    fail('schema applied', 'Collections are missing. Run: npm run db:push')
  }

  // ── Data migrations ──────────────────────────────────────────────────────
  try {
    const applied = await db.dataMigration.count()
    if (applied === 0) {
      warn('data migrations', 'None applied. Run: npm run db:migrate-data (creates TTL indexes)')
    } else {
      pass('data migrations', `(${applied} applied)`)
    }
  } catch {
    warn('data migrations', 'Could not read the migration ledger.')
  }

  // ── Soft-delete invariant ────────────────────────────────────────────────
  // Prisma reads `deletedAt: null` on MongoDB as "present and null", so a
  // document missing the field is invisible to every filtered read — silently.
  // See src/lib/db/soft-delete-extension.ts. This is the check that turns that
  // trap into a visible failure.
  try {
    const collections = [
      'organizations', 'environments', 'users', 'roles', 'memberships',
      'projects', 'checklist_templates', 'template_versions',
      'project_templates', 'deployment_runs', 'deployment_comments', 'attachments',
    ]
    const broken: string[] = []

    for (const collection of collections) {
      const result = (await db.$runCommandRaw({
        count: collection,
        query: { deletedAt: { $exists: false } },
      })) as { n?: number }
      if ((result.n ?? 0) > 0) broken.push(`${collection} (${result.n})`)
    }

    if (broken.length > 0) {
      fail(
        'soft-delete invariant',
        `Documents are missing the deletedAt field and will be INVISIBLE to the app:
` +
          `        ${broken.join(', ')}
` +
          `      Fix with: npm run db:migrate-data`,
      )
    } else {
      pass('soft-delete invariant', '(deletedAt present everywhere)')
    }
  } catch (error) {
    warn('soft-delete invariant', (error as Error).message)
  }

  // ── Bootstrap admin ──────────────────────────────────────────────────────
  try {
    const superAdminRoles = await db.role.findMany({
      where: { isSuperAdmin: true, deletedAt: null },
      select: { id: true },
    })
    const admins = await db.user.count({
      where: {
        status: 'ACTIVE',
        deletedAt: null,
        roleIds: { hasSome: superAdminRoles.map((r) => r.id) },
      },
    })

    if (admins === 0) {
      // Recoverable only outside the UI, so it is worth flagging loudly.
      fail(
        'an active administrator exists',
        'No active super-admin. Nobody can grant permissions.\n' +
          '      Fix with: npm run grant:admin -- <email>',
      )
    } else {
      pass('active administrator', `(${admins})`)
    }
  } catch (error) {
    warn('administrator check', (error as Error).message)
  }

  // ── Email provider ───────────────────────────────────────────────────────
  const provider = process.env.EMAIL_PROVIDER ?? 'console'
  const emailEnabled = !['false', '0'].includes(process.env.EMAIL_ENABLED ?? 'true')
  const configSource = process.env.EMAIL_CONFIG_SOURCE ?? 'settings'

  if (!emailEnabled) {
    warn(
      'email disabled (EMAIL_ENABLED=false)',
      'Nothing is sent. Notifications are still queued and recorded, so they\n' +
        '      can be retried once a provider exists — but invitations and password\n' +
        '      resets will not reach anyone until then.',
    )
  } else if (provider === 'console' || provider === 'noop') {
    warn(
      `email provider "${provider}"`,
      'Emails are printed to the terminal, not sent. Fine for development;\n' +
        '      invitations and password resets will not arrive for real users.',
    )
  } else {
    pass(`email provider "${provider}"`)
  }

  // A seeded Setting row defaults emailProvider to "gmail" and silently outranks
  // EMAIL_PROVIDER, which is a confusing way to discover you have no credentials.
  if (emailEnabled && configSource === 'settings' && (provider === 'console' || provider === 'noop')) {
    warn(
      'EMAIL_CONFIG_SOURCE="settings"',
      `The Setting row can override EMAIL_PROVIDER="${provider}" — its schema default\n` +
        '      is "gmail". Set EMAIL_CONFIG_SOURCE="env" to pin transport to this file.',
    )
  }

  report()
}

function report() {
  console.log('')
  if (failures > 0) {
    console.log(`${failures} problem(s) must be fixed${warnings ? `, ${warnings} warning(s)` : ''}.\n`)
    process.exitCode = 1
  } else if (warnings > 0) {
    console.log(`Ready, with ${warnings} warning(s).\n`)
  } else {
    console.log('Everything checks out.\n')
  }
}

main()
  .catch((error) => {
    console.error('\nDoctor failed unexpectedly:\n')
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void db.$disconnect())
