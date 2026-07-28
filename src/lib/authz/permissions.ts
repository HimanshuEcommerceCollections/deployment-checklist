/**
 * The complete permission vocabulary of the system.
 *
 * ── Why this lives in code ───────────────────────────────────────────────────
 * Your brief says "permissions should not be hardcoded". The workable reading:
 *
 *   • Permission STRINGS are declared here, because code references them. A
 *     permission no code checks is decoration; a permission invented at runtime
 *     can never be enforced. This file is the contract.
 *   • ROLES are data (the `roles` collection). Adding "QA", "DevOps" or
 *     "Release Manager" with any mix of these permissions is data entry — no
 *     deploy, no code change, no migration.
 *   • GRANTS are data (`User.roleIds` for org-wide, `Membership` for
 *     project-scoped).
 *
 * What is genuinely never hardcoded is the mapping from role to permission, and
 * the check itself. Business logic asks `can(ctx, PERMISSIONS.deployment.complete)`
 * and never `if (user.role === 'admin')`. An ESLint rule fails the build on any
 * comparison against a role identity.
 *
 * ── Adding a permission ──────────────────────────────────────────────────────
 *   1. add it to PERMISSION_DEFINITIONS below
 *   2. `pnpm tsx prisma/seeds/permissions.seed.ts` (idempotent upsert)
 *   3. grant it to whichever roles need it, in the admin UI
 * The admin role holds "*" so it needs no step 3.
 */

/** Semantic grouping — drives the section headings in the role editor. */
export const PERMISSION_GROUPS = {
  projects: 'Projects',
  templates: 'Checklist Templates',
  deployments: 'Deployments',
  execution: 'Checklist Execution',
  collaboration: 'Comments & Attachments',
  users: 'Users & Access',
  admin: 'Administration',
} as const

export type PermissionGroup = keyof typeof PERMISSION_GROUPS

export interface PermissionDefinition {
  /** Dot-notated key. `resource.action`. This is what code and roles reference. */
  key: string
  group: PermissionGroup
  label: string
  description: string
  /**
   * True when the permission cannot meaningfully be granted per-project.
   * `settings.manage` is global; `deployment.create` is not.
   */
  globalOnly?: boolean
  /** Rendered with a warning affordance in the role editor. */
  dangerous?: boolean
}

// ---------------------------------------------------------------------------
//  Catalog
// ---------------------------------------------------------------------------

export const PERMISSION_DEFINITIONS: readonly PermissionDefinition[] = [
  // ── Projects ──────────────────────────────────────────────────────────────
  { key: 'project.read',    group: 'projects', label: 'View projects',   description: 'See projects and their details.' },
  { key: 'project.create',  group: 'projects', label: 'Create projects', description: 'Add a new project.', globalOnly: true },
  { key: 'project.edit',    group: 'projects', label: 'Edit projects',   description: 'Change name, description, colour, status and enabled environments.' },
  { key: 'project.delete',  group: 'projects', label: 'Delete projects', description: 'Move a project to the trash (soft delete).', dangerous: true },
  { key: 'project.restore', group: 'projects', label: 'Restore projects', description: 'Recover a project from the trash.' },
  { key: 'project.members.manage', group: 'projects', label: 'Manage project members', description: 'Grant or revoke project-scoped roles.' },
  { key: 'project.template.assign', group: 'projects', label: 'Assign templates', description: 'Choose which checklist templates a project may use.' },

  // ── Templates ─────────────────────────────────────────────────────────────
  { key: 'template.read',      group: 'templates', label: 'View templates',      description: 'See templates, versions, sections and items.' },
  { key: 'template.manage',    group: 'templates', label: 'Manage templates',    description: 'Create, edit, duplicate and reorder templates, sections and items.' },
  { key: 'template.publish',   group: 'templates', label: 'Publish versions',    description: 'Freeze a draft as a new published version used by future deployments.', dangerous: true },
  { key: 'template.delete',    group: 'templates', label: 'Delete templates',    description: 'Soft-delete a template, version, section or item.', dangerous: true },
  { key: 'template.restore',   group: 'templates', label: 'Restore templates',   description: 'Recover template content from the trash.' },
  { key: 'template.deprecate', group: 'templates', label: 'Deprecate versions',  description: 'Mark a published version as no longer recommended.' },

  // ── Deployments ───────────────────────────────────────────────────────────
  { key: 'deployment.read',      group: 'deployments', label: 'View deployments',   description: 'See deployment runs and their history.' },
  { key: 'deployment.create',    group: 'deployments', label: 'Create deployments', description: 'Start a new deployment run from a template.' },
  { key: 'deployment.edit',      group: 'deployments', label: 'Edit deployments',   description: 'Change version, title, release notes and schedule while in draft or progress.' },
  { key: 'deployment.start',     group: 'deployments', label: 'Start deployments',  description: 'Move a run from Draft to In Progress.' },
  { key: 'deployment.complete',  group: 'deployments', label: 'Complete deployments', description: 'Close a run as Completed once the checklist gate passes.', dangerous: true },
  { key: 'deployment.fail',      group: 'deployments', label: 'Mark as failed',     description: 'Record that a deployment failed.' },
  { key: 'deployment.cancel',    group: 'deployments', label: 'Cancel deployments', description: 'Abandon a run before completion.' },
  { key: 'deployment.rollback',  group: 'deployments', label: 'Record rollbacks',   description: 'Mark a completed run as rolled back and open a rollback run.', dangerous: true },
  { key: 'deployment.delete',    group: 'deployments', label: 'Delete deployments', description: 'Soft-delete a run. Audit history is retained regardless.', dangerous: true },
  { key: 'deployment.restore',   group: 'deployments', label: 'Restore deployments', description: 'Recover a run from the trash.' },
  { key: 'deployment.export',    group: 'deployments', label: 'Export history',     description: 'Download deployment history as CSV or XLSX.' },
  /**
   * Environment-scoped escalation. Checked IN ADDITION to `deployment.create`
   * when the target environment has `isProduction`. Lets you hand Developers
   * free rein on staging while gating production, with no code change.
   */
  { key: 'deployment.production', group: 'deployments', label: 'Deploy to production', description: 'Required, on top of Create, to target an environment flagged as production.', dangerous: true },

  // ── Checklist execution ───────────────────────────────────────────────────
  { key: 'deployment.execute',      group: 'execution', label: 'Check items',        description: 'Tick and untick checklist items on a run.' },
  { key: 'deployment.item.skip',    group: 'execution', label: 'Skip items',         description: 'Mark an item not applicable to this run, excluding it from the completion gate.', dangerous: true },
  { key: 'deployment.item.override', group: 'execution', label: 'Override evidence', description: 'Check an item that requires evidence without providing any.', dangerous: true },
  { key: 'deployment.item.uncheck_other', group: 'execution', label: "Untick others' items", description: 'Untick an item that a different user ticked.' },

  // ── Collaboration ─────────────────────────────────────────────────────────
  { key: 'comment.read',          group: 'collaboration', label: 'View comments',   description: 'Read deployment comments.' },
  { key: 'comment.create',        group: 'collaboration', label: 'Add comments',    description: 'Post a comment on a deployment.' },
  { key: 'comment.edit_own',      group: 'collaboration', label: 'Edit own comments', description: 'Change your own comments.' },
  { key: 'comment.delete_own',    group: 'collaboration', label: 'Delete own comments', description: 'Remove your own comments.' },
  { key: 'comment.moderate',      group: 'collaboration', label: 'Moderate comments', description: "Edit or delete anyone's comments.", dangerous: true },
  { key: 'attachment.read',       group: 'collaboration', label: 'View attachments', description: 'List and download attached files.' },
  { key: 'attachment.upload',     group: 'collaboration', label: 'Upload attachments', description: 'Attach files to deployments, comments and checklist items.' },
  { key: 'attachment.delete_own', group: 'collaboration', label: 'Delete own attachments', description: 'Remove files you uploaded.' },
  { key: 'attachment.delete_any', group: 'collaboration', label: 'Delete any attachment', description: 'Remove files uploaded by anyone.', dangerous: true },

  // ── Users & access ────────────────────────────────────────────────────────
  { key: 'user.read',      group: 'users', label: 'View users',      description: 'See the user directory.', globalOnly: true },
  { key: 'user.invite',    group: 'users', label: 'Invite users',    description: 'Send an invitation with roles and project grants.', globalOnly: true },
  { key: 'user.edit',      group: 'users', label: 'Edit users',      description: 'Change name, job title and global roles.', globalOnly: true },
  { key: 'user.suspend',   group: 'users', label: 'Suspend users',   description: 'Block sign-in and revoke active sessions immediately.', globalOnly: true, dangerous: true },
  { key: 'user.delete',    group: 'users', label: 'Delete users',    description: 'Soft-delete a user account.', globalOnly: true, dangerous: true },
  { key: 'user.restore',   group: 'users', label: 'Restore users',   description: 'Reactivate a soft-deleted user.', globalOnly: true },
  { key: 'role.read',      group: 'users', label: 'View roles',      description: 'See roles and their permissions.', globalOnly: true },
  { key: 'role.manage',    group: 'users', label: 'Manage roles',    description: 'Create roles and change which permissions they grant.', globalOnly: true, dangerous: true },

  // ── Administration ────────────────────────────────────────────────────────
  { key: 'admin.access',        group: 'admin', label: 'Access admin area', description: 'Open the administration section. Required by every admin page.', globalOnly: true },
  { key: 'audit.read',          group: 'admin', label: 'View audit log',    description: 'Read the full audit trail.', globalOnly: true },
  { key: 'audit.export',        group: 'admin', label: 'Export audit log',  description: 'Download audit entries.', globalOnly: true },
  { key: 'environment.manage',  group: 'admin', label: 'Manage environments', description: 'Add and configure deployment environments.', globalOnly: true },
  { key: 'settings.read',       group: 'admin', label: 'View settings',     description: 'See organisation settings. Secrets are always masked.', globalOnly: true },
  { key: 'settings.manage',     group: 'admin', label: 'Manage settings',   description: 'Change branding, email, storage, security and retention settings.', globalOnly: true, dangerous: true },
  { key: 'notification.read',   group: 'admin', label: 'View outbox',       description: 'Inspect queued and failed notifications.', globalOnly: true },
  { key: 'notification.retry',  group: 'admin', label: 'Retry notifications', description: 'Requeue a failed notification.', globalOnly: true },
] as const

// ---------------------------------------------------------------------------
//  Typed accessors
// ---------------------------------------------------------------------------

/**
 * Nested, autocompleting handle for every permission.
 *
 *   PERMISSIONS.deployment.complete   → "deployment.complete"
 *   PERMISSIONS.template.publish      → "template.publish"
 *
 * Always reference permissions through this object. A typo becomes a type error
 * instead of a check that silently never passes.
 */
export const PERMISSIONS = {
  project: {
    read: 'project.read', create: 'project.create', edit: 'project.edit',
    delete: 'project.delete', restore: 'project.restore',
    membersManage: 'project.members.manage', templateAssign: 'project.template.assign',
  },
  template: {
    read: 'template.read', manage: 'template.manage', publish: 'template.publish',
    delete: 'template.delete', restore: 'template.restore', deprecate: 'template.deprecate',
  },
  deployment: {
    read: 'deployment.read', create: 'deployment.create', edit: 'deployment.edit',
    start: 'deployment.start', complete: 'deployment.complete', fail: 'deployment.fail',
    cancel: 'deployment.cancel', rollback: 'deployment.rollback',
    delete: 'deployment.delete', restore: 'deployment.restore',
    export: 'deployment.export', production: 'deployment.production',
    execute: 'deployment.execute',
    itemSkip: 'deployment.item.skip',
    itemOverride: 'deployment.item.override',
    itemUncheckOther: 'deployment.item.uncheck_other',
  },
  comment: {
    read: 'comment.read', create: 'comment.create', editOwn: 'comment.edit_own',
    deleteOwn: 'comment.delete_own', moderate: 'comment.moderate',
  },
  attachment: {
    read: 'attachment.read', upload: 'attachment.upload',
    deleteOwn: 'attachment.delete_own', deleteAny: 'attachment.delete_any',
  },
  user: {
    read: 'user.read', invite: 'user.invite', edit: 'user.edit',
    suspend: 'user.suspend', delete: 'user.delete', restore: 'user.restore',
  },
  role: { read: 'role.read', manage: 'role.manage' },
  admin: { access: 'admin.access' },
  audit: { read: 'audit.read', export: 'audit.export' },
  environment: { manage: 'environment.manage' },
  settings: { read: 'settings.read', manage: 'settings.manage' },
  notification: { read: 'notification.read', retry: 'notification.retry' },
} as const

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T]

/** Union of every valid permission string. */
export type Permission = Leaves<typeof PERMISSIONS>

/** The super-admin wildcard. Grant sparingly; it bypasses every check below. */
export const WILDCARD = '*' as const

/**
 * Anything storable in `Role.permissions`.
 *
 * Wider than `Permission` on purpose: `*` and prefix forms like `deployment.*`
 * are valid grants but are not catalog entries, because nothing checks them
 * directly — `satisfies()` expands them at evaluation time.
 */
export type Grant = Permission | typeof WILDCARD | `${string}.${typeof WILDCARD}`

export const ALL_PERMISSION_KEYS: readonly string[] = PERMISSION_DEFINITIONS.map((p) => p.key)
export const ALL_PERMISSIONS: readonly string[] = ALL_PERMISSION_KEYS

const KEY_SET = new Set(ALL_PERMISSION_KEYS)

/** Guard for permission strings arriving from the database or an API payload. */
export function isKnownPermission(key: string): key is Permission {
  return KEY_SET.has(key)
}

/**
 * Drop permissions that no longer exist in the catalog.
 *
 * Roles are data and this file is code, so a role can outlive a permission that
 * was removed in a later release. Filtering on read means a stale grant is
 * inert rather than throwing — and `notifyStalePermissions` reports it so it can
 * be cleaned up rather than lingering unnoticed.
 */
export function pruneUnknown(keys: readonly string[]): {
  valid: Grant[]
  unknown: string[]
} {
  const valid: Grant[] = []
  const unknown: string[] = []

  for (const key of keys) {
    if (key === WILDCARD || isKnownPermission(key) || isPrefixWildcard(key)) {
      valid.push(key as Grant)
    } else {
      unknown.push(key)
    }
  }

  return { valid, unknown }
}

/**
 * `deployment.*` is valid if at least one catalog permission sits under that
 * prefix. Checking rather than accepting any `x.*` means a typo like
 * `deployments.*` is reported as stale instead of silently granting nothing.
 */
function isPrefixWildcard(key: string): boolean {
  if (!key.endsWith(`.${WILDCARD}`)) return false
  const prefix = key.slice(0, -2)
  return ALL_PERMISSION_KEYS.some((candidate) => candidate.startsWith(`${prefix}.`))
}

/** Grouped view for the role editor UI. */
export function definitionsByGroup(): Array<{
  group: PermissionGroup
  label: string
  permissions: PermissionDefinition[]
}> {
  return (Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((group) => ({
    group,
    label: PERMISSION_GROUPS[group],
    permissions: PERMISSION_DEFINITIONS.filter((p) => p.group === group),
  }))
}

/** Permissions that only make sense when granted org-wide. */
export const GLOBAL_ONLY_PERMISSIONS: ReadonlySet<string> = new Set(
  PERMISSION_DEFINITIONS.filter((p) => p.globalOnly).map((p) => p.key),
)

// ---------------------------------------------------------------------------
//  Starter role definitions (seed only — thereafter they are editable data)
// ---------------------------------------------------------------------------

/**
 * Seeded once by prisma/seeds/roles.seed.ts. After seeding these are ordinary
 * documents: an admin can change Developer's permissions, or add a Release
 * Manager, without touching this file. QA / DevOps / Release Manager are
 * included as worked examples that the requirements named.
 */
export const SEED_ROLES = [
  {
    key: 'admin',
    name: 'Admin',
    description: 'Unrestricted access to every project and setting.',
    color: '#ef5f6b',
    permissions: [WILDCARD],
    isSystem: true,
    isSuperAdmin: true,
  },
  {
    key: 'developer',
    name: 'Developer',
    description: 'Runs deployments. Cannot modify checklist templates.',
    color: '#4fc7e8',
    isDefault: true,
    permissions: [
      PERMISSIONS.project.read,
      PERMISSIONS.template.read,
      PERMISSIONS.deployment.read, PERMISSIONS.deployment.create,
      PERMISSIONS.deployment.edit, PERMISSIONS.deployment.start,
      PERMISSIONS.deployment.execute, PERMISSIONS.deployment.fail,
      PERMISSIONS.deployment.cancel, PERMISSIONS.deployment.export,
      PERMISSIONS.comment.read, PERMISSIONS.comment.create,
      PERMISSIONS.comment.editOwn, PERMISSIONS.comment.deleteOwn,
      PERMISSIONS.attachment.read, PERMISSIONS.attachment.upload,
      PERMISSIONS.attachment.deleteOwn,
      // Deliberately absent: deployment.complete and deployment.production.
      // Closing a release and shipping to production are separable decisions —
      // the four-eyes default. Grant them if that is not your model.
    ],
  },
  {
    key: 'qa',
    name: 'QA',
    description: 'Verifies checklist items and signs off testing.',
    color: '#f0b54c',
    permissions: [
      PERMISSIONS.project.read, PERMISSIONS.template.read,
      PERMISSIONS.deployment.read, PERMISSIONS.deployment.execute,
      PERMISSIONS.comment.read, PERMISSIONS.comment.create, PERMISSIONS.comment.editOwn,
      PERMISSIONS.attachment.read, PERMISSIONS.attachment.upload,
    ],
  },
  {
    key: 'devops',
    name: 'DevOps',
    description: 'Owns infrastructure items and production execution.',
    color: '#35d68f',
    permissions: [
      PERMISSIONS.project.read, PERMISSIONS.template.read,
      PERMISSIONS.deployment.read, PERMISSIONS.deployment.create,
      PERMISSIONS.deployment.start, PERMISSIONS.deployment.execute,
      PERMISSIONS.deployment.complete, PERMISSIONS.deployment.fail,
      PERMISSIONS.deployment.rollback, PERMISSIONS.deployment.production,
      PERMISSIONS.deployment.itemSkip, PERMISSIONS.deployment.export,
      PERMISSIONS.comment.read, PERMISSIONS.comment.create, PERMISSIONS.comment.editOwn,
      PERMISSIONS.attachment.read, PERMISSIONS.attachment.upload,
      PERMISSIONS.environment.manage,
    ],
  },
  {
    key: 'release-manager',
    name: 'Release Manager',
    description: 'Owns the release gate and template content.',
    color: '#a78bfa',
    permissions: [
      PERMISSIONS.project.read, PERMISSIONS.project.edit, PERMISSIONS.project.templateAssign,
      PERMISSIONS.template.read, PERMISSIONS.template.manage,
      PERMISSIONS.template.publish, PERMISSIONS.template.deprecate,
      PERMISSIONS.deployment.read, PERMISSIONS.deployment.create,
      PERMISSIONS.deployment.edit, PERMISSIONS.deployment.start,
      PERMISSIONS.deployment.complete, PERMISSIONS.deployment.cancel,
      PERMISSIONS.deployment.fail, PERMISSIONS.deployment.rollback,
      PERMISSIONS.deployment.production, PERMISSIONS.deployment.export,
      PERMISSIONS.deployment.itemSkip, PERMISSIONS.deployment.itemUncheckOther,
      PERMISSIONS.comment.read, PERMISSIONS.comment.create,
      PERMISSIONS.comment.editOwn, PERMISSIONS.comment.moderate,
      PERMISSIONS.attachment.read, PERMISSIONS.attachment.upload,
      PERMISSIONS.audit.read,
    ],
  },
] as const
