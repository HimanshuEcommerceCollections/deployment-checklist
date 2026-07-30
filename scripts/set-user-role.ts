/**
 * Set a user's global role.
 *
 *   npm run set:role -- someone@corp.com engineer
 *   npm run set:role -- someone@corp.com            → lists the available roles
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Roles can currently only be chosen at invite time: the admin users list has no
 * actions column, so there is no way to change someone's role afterwards without
 * re-inviting them — which also rewrites their roles from the invite form and
 * revokes their outstanding invitation. This is the stopgap until docs/14 §14.5A
 * lands. It is deliberately narrow: one user, one role, org-wide.
 *
 * ── Replaces, does not union ─────────────────────────────────────────────────
 * Unlike `grant:admin`, which adds a role because it is a recovery lever, this
 * SETS the user's global roles to exactly the one named. "Reassign to engineer"
 * must not leave the old role attached, or the thing you were migrating away from
 * is still granting permissions. Before/after is printed so the change is visible.
 *
 * Uses the raw PrismaClient like the seed and grant:admin do: the tenant and
 * soft-delete extensions assume a request scope, and this legitimately operates
 * outside one. `audit.record()` is unavailable for the same reason
 * (`import 'server-only'`), so the entry is written directly.
 *
 * Idempotent — re-running with the same role changes nothing and says so.
 */
import './load-env'

import { PrismaClient } from '@prisma/client'

import { AUDIT_ACTIONS } from '../src/lib/audit/actions'

const db = new PrismaClient()

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase()
  const roleKey = (process.argv[3] ?? '').trim()

  if (!email) {
    console.error('\nUsage: npm run set:role -- <email> <role-key>\n')
    process.exitCode = 1
    return
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, organizationId: true, roleIds: true, status: true },
  })

  if (!user) {
    const known = await db.user.findMany({ select: { email: true }, orderBy: { createdAt: 'asc' }, take: 25 })
    console.error(`\nNo user with email "${email}".`)
    console.error('  Existing users:')
    for (const u of known) console.error(`    ${u.email}`)
    console.error('')
    process.exitCode = 1
    return
  }

  const roles = await db.role.findMany({
    where: { organizationId: user.organizationId, deletedAt: null },
    select: { id: true, key: true, name: true, description: true },
    orderBy: { key: 'asc' },
  })

  const target = roles.find((role) => role.key === roleKey)

  if (!target) {
    console.error(roleKey ? `\nNo active role "${roleKey}".\n` : '\nWhich role?\n')
    console.error('  Available roles:')
    for (const role of roles) {
      console.error(`    ${role.key.padEnd(18)} ${role.description ?? role.name}`)
    }
    console.error('')
    process.exitCode = 1
    return
  }

  const before = user.roleIds
    .map((id) => roles.find((role) => role.id === id)?.key ?? `(retired:${id})`)
    .join(', ')

  if (user.roleIds.length === 1 && user.roleIds[0] === target.id) {
    console.log(`\n${user.email} already holds only "${target.key}" — nothing to do.\n`)
    return
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        roleIds: { set: [target.id] },
        // sessionEpoch is deliberately NOT bumped. Permissions are resolved per
        // request by getRequestContext() and never carried on the JWT, so the
        // change is live on this user's next request. Bumping would force a
        // pointless re-login. Same reasoning as scripts/grant-super-admin.ts.
      },
    })

    await tx.auditLog.create({
      data: {
        action: AUDIT_ACTIONS.user.roleChanged,
        organizationId: user.organizationId,
        actorId: null,
        actorEmail: 'system@internal',
        actorName: 'System',
        actorRoles: [],
        actorType: 'system',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.email,
        targetUserId: user.id,
        changes: [{ field: 'roleIds', from: user.roleIds, to: [target.id] }],
        metadata: { role: target.key, previous: before, via: 'scripts/set-user-role.ts' },
        summary: `${user.email} was assigned the "${target.name}" role via set:role`,
        requestId: 'set-user-role',
      },
    })
  })

  console.log(`\n${user.email}`)
  console.log(`  before: ${before || '(none)'}`)
  console.log(`  after:  ${target.key}`)
  console.log('  Effective on the next request; no sign-out required.\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void db.$disconnect())
