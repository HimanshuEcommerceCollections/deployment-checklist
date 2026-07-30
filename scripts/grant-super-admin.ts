/**
 * Grant a user every permission.
 *
 *   npm run grant:admin                      → SEED_ADMIN_EMAIL (or admin@example.com)
 *   npm run grant:admin -- someone@corp.com
 *
 * ── What "every permission" means here ──────────────────────────────────────
 * Not a list of permission strings. The super-admin role holds the wildcard `*`
 * and `isSuperAdmin: true`, and `can()` short-circuits on both. Copying
 * ALL_PERMISSION_KEYS onto a role instead would drift the moment a permission is
 * added to the catalog — the wildcard cannot.
 *
 * ── Why this is a script and not an admin-UI action ─────────────────────────
 * It is the bootstrap lever: the thing you need when nobody can reach the role
 * editor, because granting `role.manage` through the role editor requires
 * `role.manage`. Everything else about roles is data entry in the UI.
 *
 * Uses the raw PrismaClient like the seed does: the tenant and soft-delete
 * extensions assume a request scope, and this legitimately operates outside one.
 * `audit.record()` is unavailable for the same reason (`import 'server-only'`),
 * so the entry is written directly against the same model the service writes.
 *
 * Idempotent — re-running on an already-granted user changes nothing and says so.
 */
import './load-env'

import { PrismaClient } from '@prisma/client'

import { AUDIT_ACTIONS } from '../src/lib/audit/actions'
import { SEED_ROLES, WILDCARD } from '../src/lib/authz/permissions'

const db = new PrismaClient()

/** The `admin` entry in SEED_ROLES is the single source of truth for the role. */
const ADMIN_ROLE = SEED_ROLES.find((role) => role.key === 'admin')!

async function main(): Promise<void> {
  const email = (process.argv[2] ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com')
    .trim()
    .toLowerCase()

  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      organizationId: true,
      roleIds: true,
      status: true,
      deletedAt: true,
    },
  })

  if (!user) {
    const known = await db.user.findMany({
      select: { email: true, status: true },
      orderBy: { createdAt: 'asc' },
      take: 25,
    })

    console.error(`\nNo user with email "${email}".\n`)
    if (known.length === 0) {
      console.error('  The users collection is empty — run `npm run db:seed` first.\n')
    } else {
      console.error('  Existing users:')
      for (const u of known) console.error(`    ${u.email}  (${u.status})`)
      console.error('')
    }
    process.exitCode = 1
    return
  }

  // The super-admin role is per-organization, so resolve it inside the user's
  // org rather than globally — two orgs each have their own `admin` row.
  let role = await db.role.findFirst({
    where: { organizationId: user.organizationId, isSuperAdmin: true, deletedAt: null },
    select: { id: true, key: true, name: true, permissions: true },
  })

  // Absent on a database seeded before the role existed. Creating it is safer
  // than aborting: without it there is no way back into the admin UI.
  if (!role) {
    role = await db.role.upsert({
      where: { organizationId_key: { organizationId: user.organizationId, key: ADMIN_ROLE.key } },
      create: {
        organizationId: user.organizationId,
        key: ADMIN_ROLE.key,
        name: ADMIN_ROLE.name,
        description: ADMIN_ROLE.description,
        color: ADMIN_ROLE.color,
        permissions: [...ADMIN_ROLE.permissions],
        isSystem: true,
        isSuperAdmin: true,
      },
      update: { isSuperAdmin: true, permissions: [...ADMIN_ROLE.permissions], deletedAt: null },
      select: { id: true, key: true, name: true, permissions: true },
    })
    console.log(`  created the "${role.key}" role in this organization`)
  }

  // A role flagged isSuperAdmin but missing the wildcard would pass can() via
  // the flag and fail the role editor's own display of what it grants. Repair it.
  if (!role.permissions.includes(WILDCARD)) {
    await db.role.update({
      where: { id: role.id },
      data: { permissions: [WILDCARD] },
    })
    console.log(`  repaired "${role.key}" — permissions did not include "${WILDCARD}"`)
  }

  const alreadyGranted = user.roleIds.includes(role.id)
  const needsReactivation = user.status !== 'ACTIVE' || user.deletedAt !== null

  if (alreadyGranted && !needsReactivation) {
    console.log(`\n${user.email} already holds "${role.key}" — nothing to do.\n`)
    return
  }

  // Union, not overwrite: this grants a permission set, it does not audit-revoke
  // whatever else the user was deliberately given.
  const nextRoleIds = alreadyGranted ? user.roleIds : [...user.roleIds, role.id]

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        roleIds: { set: nextRoleIds },
        // All the permissions in the world are useless to an account that cannot
        // sign in. Suspension is what this script is usually called to undo.
        status: 'ACTIVE',
        deletedAt: null,
        // sessionEpoch is deliberately NOT bumped. Permissions are resolved per
        // request in getRequestContext() and never carried on the JWT, so the
        // grant is live on the user's next request. Bumping would only force a
        // pointless re-login. See src/lib/auth/auth.config.ts.
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
        changes: [{ field: 'roleIds', from: user.roleIds, to: nextRoleIds }],
        metadata: { grantedRole: role.key, via: 'scripts/grant-super-admin.ts' },
        summary: `${user.email} was granted the "${role.name}" role via grant:admin`,
        requestId: 'grant-super-admin',
      },
    })
  })

  console.log(`\n${user.email} now holds "${role.key}" (${WILDCARD} — every permission).`)
  if (needsReactivation) console.log(`  status ${user.status} → ACTIVE`)
  console.log('  Effective on the next request; no sign-out required.\n')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => void db.$disconnect())
