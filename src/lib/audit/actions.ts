/**
 * The audit action catalog.
 *
 * ── Why `AuditLog.action` is a String and not a Prisma enum ──────────────────
 * Same reasoning as the permission catalog: the vocabulary is declared in code
 * because code emits it, but it must be extensible without a schema change. A
 * Prisma enum would mean every new domain event requires a `db push` and a
 * redeploy in lockstep — and during a rolling deploy, an old instance reading a
 * row with a new enum value is a deserialisation error.
 *
 * A String column plus this catalog gives type safety at the call site (the
 * `AuditAction` union below) with zero coupling at the storage layer.
 *
 * ── Naming ──────────────────────────────────────────────────────────────────
 *   <resource>.<event>            project.created
 *   <resource>.<sub>_<event>      template.version_published
 *   <resource>.<child>.<event>    deployment.item.checked
 *
 * Events are PAST TENSE. An audit log records what happened, not what was
 * attempted — `deployment.completed`, never `deployment.complete`.
 */

export const AUDIT_ACTIONS = {
  // ── Authentication ────────────────────────────────────────────────────────
  auth: {
    loginSucceeded: 'auth.login_succeeded',
    loginFailed: 'auth.login_failed',
    loginLocked: 'auth.login_locked',
    loginInactive: 'auth.login_inactive',
    rateLimited: 'auth.rate_limited',
    logout: 'auth.logout',
    passwordResetRequested: 'auth.password_reset_requested',
    passwordResetCompleted: 'auth.password_reset_completed',
    passwordChanged: 'auth.password_changed',
    sessionRevoked: 'auth.session_revoked',
  },

  // ── Users & access ────────────────────────────────────────────────────────
  user: {
    invited: 'user.invited',
    inviteAccepted: 'user.invite_accepted',
    inviteResent: 'user.invite_resent',
    inviteRevoked: 'user.invite_revoked',
    created: 'user.created',
    updated: 'user.updated',
    roleChanged: 'user.role_changed',
    suspended: 'user.suspended',
    reactivated: 'user.reactivated',
    deleted: 'user.deleted',
    restored: 'user.restored',
    purged: 'user.purged',
    profileUpdated: 'user.profile_updated',
  },

  role: {
    created: 'role.created',
    updated: 'role.updated',
    permissionsChanged: 'role.permissions_changed',
    deleted: 'role.deleted',
    restored: 'role.restored',
  },

  // ── Projects ──────────────────────────────────────────────────────────────
  project: {
    created: 'project.created',
    updated: 'project.updated',
    statusChanged: 'project.status_changed',
    deleted: 'project.deleted',
    restored: 'project.restored',
    memberAdded: 'project.member_added',
    memberRoleChanged: 'project.member_role_changed',
    memberRemoved: 'project.member_removed',
    templatesChanged: 'project.templates_changed',
  },

  // ── Templates ─────────────────────────────────────────────────────────────
  template: {
    created: 'template.created',
    updated: 'template.updated',
    duplicated: 'template.duplicated',
    deleted: 'template.deleted',
    restored: 'template.restored',

    versionCreated: 'template.version_created',
    versionUpdated: 'template.version_updated',
    versionPublished: 'template.version_published',
    versionDeprecated: 'template.version_deprecated',
    versionDeleted: 'template.version_deleted',

    sectionCreated: 'template.section_created',
    sectionUpdated: 'template.section_updated',
    sectionDeleted: 'template.section_deleted',
    sectionRestored: 'template.section_restored',
    sectionsReordered: 'template.sections_reordered',

    itemCreated: 'template.item_created',
    itemUpdated: 'template.item_updated',
    itemDeleted: 'template.item_deleted',
    itemRestored: 'template.item_restored',
    itemsReordered: 'template.items_reordered',
  },

  // ── Deployments ───────────────────────────────────────────────────────────
  deployment: {
    created: 'deployment.created',
    updated: 'deployment.updated',
    started: 'deployment.started',
    blocked: 'deployment.blocked',
    unblocked: 'deployment.unblocked',
    completed: 'deployment.completed',
    failed: 'deployment.failed',
    cancelled: 'deployment.cancelled',
    rolledBack: 'deployment.rolled_back',
    deleted: 'deployment.deleted',
    restored: 'deployment.restored',
    exported: 'deployment.exported',

    itemChecked: 'deployment.item.checked',
    itemUnchecked: 'deployment.item.unchecked',
    itemsBulkChecked: 'deployment.items_bulk_checked',
    itemSkipped: 'deployment.item.skipped',
    itemUnskipped: 'deployment.item.unskipped',
    itemNoteAdded: 'deployment.item.note_added',
    itemEvidenceOverridden: 'deployment.item.evidence_overridden',

    commentAdded: 'deployment.comment_added',
    commentEdited: 'deployment.comment_edited',
    commentDeleted: 'deployment.comment_deleted',
  },

  // ── Configuration ─────────────────────────────────────────────────────────
  environment: {
    created: 'environment.created',
    updated: 'environment.updated',
    deleted: 'environment.deleted',
    restored: 'environment.restored',
  },

  settings: {
    updated: 'settings.updated',
    emailProviderChanged: 'settings.email_provider_changed',
    smtpCredentialsChanged: 'settings.smtp_credentials_changed',
    emailTestSent: 'settings.email_test_sent',
  },

  notification: {
    deadLettered: 'notification.dead_lettered',
    retried: 'notification.retried',
  },

  apiKey: {
    created: 'api_key.created',
    updated: 'api_key.updated',
    revoked: 'api_key.revoked',
    deleted: 'api_key.deleted',
  },

  integration: {
    created: 'integration.created',
    updated: 'integration.updated',
    enabled: 'integration.enabled',
    disabled: 'integration.disabled',
    deleted: 'integration.deleted',
    deliveryFailed: 'integration.delivery_failed',
  },

  // ── Audit of the audit ────────────────────────────────────────────────────
  audit: {
    /** Exporting the audit log is itself an auditable act. */
    exported: 'audit.exported',
    archived: 'audit.archived',
  },

  system: {
    migrationApplied: 'system.migration_applied',
    seedRun: 'system.seed_run',
    jobFailed: 'system.job_failed',
  },
} as const

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T]

/** Union of every valid action string. Typos become type errors. */
export type AuditAction = Leaves<typeof AUDIT_ACTIONS>

// ---------------------------------------------------------------------------
//  Metadata
// ---------------------------------------------------------------------------

/**
 * Actions recorded even when the structured diff is empty.
 *
 * `AuditService.record` normally skips a no-op write, otherwise every no-change
 * form save adds a row and the trail drowns in noise. But some actions ARE the
 * event regardless of whether a field moved: a login has no diff, and a
 * deployment start is worth recording even though only a timestamp changed.
 */
export const ALWAYS_LOG: ReadonlySet<string> = new Set<AuditAction>([
  AUDIT_ACTIONS.auth.loginSucceeded,
  AUDIT_ACTIONS.auth.loginFailed,
  AUDIT_ACTIONS.auth.loginLocked,
  AUDIT_ACTIONS.auth.loginInactive,
  AUDIT_ACTIONS.auth.rateLimited,
  AUDIT_ACTIONS.auth.logout,
  AUDIT_ACTIONS.auth.passwordResetRequested,
  AUDIT_ACTIONS.auth.sessionRevoked,
  AUDIT_ACTIONS.user.invited,
  AUDIT_ACTIONS.user.inviteAccepted,
  AUDIT_ACTIONS.user.inviteResent,
  AUDIT_ACTIONS.deployment.created,
  AUDIT_ACTIONS.deployment.started,
  AUDIT_ACTIONS.deployment.completed,
  AUDIT_ACTIONS.deployment.failed,
  AUDIT_ACTIONS.deployment.cancelled,
  AUDIT_ACTIONS.deployment.rolledBack,
  AUDIT_ACTIONS.deployment.exported,
  AUDIT_ACTIONS.template.versionPublished,
  AUDIT_ACTIONS.settings.emailTestSent,
  AUDIT_ACTIONS.audit.exported,
])

/**
 * Actions written through `after()` rather than inside the state transaction.
 *
 * The trade-off is explicit: a crash between response and `after()` loses one
 * entry. Acceptable for a checkbox tick (high volume, low stakes, and the
 * resulting state is still visible). NOT acceptable for a completion or a
 * permission change, which is why those are absent from this set and commit
 * atomically instead.
 */
export const DEFERRED_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  AUDIT_ACTIONS.deployment.itemChecked,
  AUDIT_ACTIONS.deployment.itemUnchecked,
  AUDIT_ACTIONS.deployment.itemNoteAdded,
  AUDIT_ACTIONS.auth.loginSucceeded,
])

/**
 * Actions surfaced in the deployment timeline UI.
 *
 * The timeline is a curated narrative, not a raw dump. Every action is still
 * queryable in the admin audit viewer; this set is what a release story reads as.
 */
export const TIMELINE_ACTIONS: ReadonlySet<string> = new Set<AuditAction>([
  AUDIT_ACTIONS.deployment.created,
  AUDIT_ACTIONS.deployment.started,
  AUDIT_ACTIONS.deployment.blocked,
  AUDIT_ACTIONS.deployment.unblocked,
  AUDIT_ACTIONS.deployment.completed,
  AUDIT_ACTIONS.deployment.failed,
  AUDIT_ACTIONS.deployment.cancelled,
  AUDIT_ACTIONS.deployment.rolledBack,
  AUDIT_ACTIONS.deployment.itemChecked,
  AUDIT_ACTIONS.deployment.itemsBulkChecked,
  AUDIT_ACTIONS.deployment.itemSkipped,
  AUDIT_ACTIONS.deployment.commentAdded,
])

/**
 * Human-readable labels for the audit viewer's action filter.
 *
 * Grouped by resource so the filter is a two-level select rather than a flat
 * list of ninety strings.
 */
export const ACTION_LABELS: Record<string, string> = {
  [AUDIT_ACTIONS.auth.loginSucceeded]: 'Signed in',
  [AUDIT_ACTIONS.auth.loginFailed]: 'Failed sign-in',
  [AUDIT_ACTIONS.auth.passwordResetCompleted]: 'Reset password',
  [AUDIT_ACTIONS.user.invited]: 'Invited a user',
  [AUDIT_ACTIONS.user.inviteAccepted]: 'Accepted an invitation',
  [AUDIT_ACTIONS.user.roleChanged]: 'Changed a user’s roles',
  [AUDIT_ACTIONS.user.suspended]: 'Suspended a user',
  [AUDIT_ACTIONS.role.permissionsChanged]: 'Changed role permissions',
  [AUDIT_ACTIONS.project.created]: 'Created a project',
  [AUDIT_ACTIONS.project.updated]: 'Edited a project',
  [AUDIT_ACTIONS.template.versionPublished]: 'Published a template version',
  [AUDIT_ACTIONS.template.sectionsReordered]: 'Reordered sections',
  [AUDIT_ACTIONS.template.itemsReordered]: 'Reordered checklist items',
  [AUDIT_ACTIONS.deployment.created]: 'Created a deployment',
  [AUDIT_ACTIONS.deployment.started]: 'Started a deployment',
  [AUDIT_ACTIONS.deployment.completed]: 'Completed a deployment',
  [AUDIT_ACTIONS.deployment.failed]: 'Marked a deployment failed',
  [AUDIT_ACTIONS.deployment.cancelled]: 'Cancelled a deployment',
  [AUDIT_ACTIONS.deployment.rolledBack]: 'Rolled back a deployment',
  [AUDIT_ACTIONS.deployment.itemChecked]: 'Checked an item',
  [AUDIT_ACTIONS.deployment.itemUnchecked]: 'Unchecked an item',
  [AUDIT_ACTIONS.deployment.itemSkipped]: 'Skipped an item',
  [AUDIT_ACTIONS.settings.smtpCredentialsChanged]: 'Changed SMTP credentials',
  [AUDIT_ACTIONS.audit.exported]: 'Exported the audit log',
  // …one entry per action; omissions fall back to the raw key.
}

export const ALL_AUDIT_ACTIONS: readonly string[] = Object.values(AUDIT_ACTIONS)
  .flatMap((group) => Object.values(group))
