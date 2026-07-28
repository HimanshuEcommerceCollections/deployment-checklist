/**
 * The reference HTML's checklist, as seed data.
 *
 * `Pre Deployment checklist.html` hardcoded ten sections and 49 items in a
 * JavaScript array. Those exact items are reproduced here verbatim and seeded as
 * `Production Deployment v1 (PUBLISHED)` — so the design reference becomes real,
 * editable, versioned data on first boot rather than something to retype.
 *
 * Two things were added that the static version had no way to express:
 *
 *   isRequired: false     for items the original text already marked conditional
 *                         ("if traffic-sensitive change", "if applicable"). With
 *                         everything required, the completion gate is
 *                         all-or-nothing and teams stop trusting it.
 *
 *   evidenceRequired      for the handful of items where a tick alone is not
 *                         worth much. "Backup taken immediately before migration
 *                         runs" is exactly the claim you want proof of at 3am.
 */

export interface SeedItem {
  label: string
  isRequired?: boolean
  evidenceRequired?: boolean
  helpText?: string
  /** Empty/absent = every environment. */
  environmentKeys?: string[]
}

export interface SeedSection {
  title: string
  description?: string
  items: SeedItem[]
}

export const PRODUCTION_DEPLOYMENT_SECTIONS: SeedSection[] = [
  {
    title: 'Code & Review',
    description: 'Everything merged, reviewed and clean before anything ships.',
    items: [
      { label: 'All code merged to the release branch (main / release/x.x)' },
      { label: 'Pull request(s) approved by required reviewers' },
      { label: 'No unresolved review comments or blocking TODOs' },
      { label: 'Linting and static analysis pass with no new warnings' },
      { label: 'Dependency versions locked (lockfile committed, no "latest" tags)' },
      { label: 'No secrets, API keys, or debug code left in the codebase' },
    ],
  },
  {
    title: 'Testing',
    items: [
      { label: 'Unit tests pass (CI green)' },
      { label: 'Integration tests pass' },
      { label: 'End-to-end / smoke tests pass on staging' },
      {
        label: 'Manual QA sign-off on critical user flows',
        evidenceRequired: true,
        helpText: 'Attach the test report or link the QA ticket.',
      },
      {
        label: 'Load/performance testing done (if traffic-sensitive change)',
        isRequired: false,
        helpText: 'Skip with a reason if this release does not touch a hot path.',
      },
      { label: 'Edge cases and error states verified' },
    ],
  },
  {
    title: 'Security',
    items: [
      { label: 'Dependency vulnerability scan run (npm audit, Snyk, Dependabot)' },
      { label: 'No hardcoded credentials or tokens' },
      { label: 'Auth/permissions changes reviewed' },
      { label: 'HTTPS/TLS enforced where applicable' },
      { label: 'Input validation & sanitization checked for new endpoints' },
    ],
  },
  {
    title: 'Database & Data',
    description: 'Only applies to releases carrying schema or data changes.',
    items: [
      { label: 'Migrations tested on a staging copy of production data', isRequired: false },
      { label: 'Migrations are backward-compatible during rollout', isRequired: false },
      {
        label: 'Backup taken immediately before migration runs',
        evidenceRequired: true,
        helpText: 'Record the snapshot id or backup timestamp. This is the one you will need.',
        environmentKeys: ['staging', 'production'],
      },
      { label: 'Rollback script/plan for migrations prepared', isRequired: false },
      { label: 'Data seed/config changes documented', isRequired: false },
    ],
  },
  {
    title: 'Configuration & Environment',
    items: [
      { label: 'Environment variables set correctly for target environment' },
      { label: 'Feature flags configured (on/off as intended)' },
      { label: 'Secrets rotated/updated in vault or secrets manager', isRequired: false },
      {
        label: 'Config diffs between staging and production reviewed',
        environmentKeys: ['production'],
      },
      { label: 'Third-party service keys/quotas confirmed (payment, email, etc.)', isRequired: false },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { label: 'Build artifacts/images created and tagged with version number' },
      { label: 'Auto-scaling / resource limits reviewed for expected load', isRequired: false },
      { label: 'CDN/cache invalidation plan ready (if static assets changed)', isRequired: false },
      {
        label: 'DNS/load balancer changes reviewed (if applicable)',
        isRequired: false,
        environmentKeys: ['staging', 'production'],
      },
      { label: 'Health checks and readiness probes configured' },
    ],
  },
  {
    title: 'Monitoring & Rollback',
    items: [
      { label: 'Logging in place for new features/changes' },
      { label: 'Alerts/dashboards updated for new metrics or endpoints', isRequired: false },
      { label: 'Error tracking (e.g. Sentry) configured for new code paths' },
      {
        label: 'Rollback plan documented and tested',
        evidenceRequired: true,
        environmentKeys: ['staging', 'production'],
      },
      {
        label: 'Owner assigned to watch metrics post-deploy',
        environmentKeys: ['production'],
      },
    ],
  },
  {
    title: 'Communication',
    items: [
      { label: 'Deployment window scheduled and communicated to team', environmentKeys: ['production'] },
      { label: 'Stakeholders notified of user-facing changes', isRequired: false },
      { label: 'Release notes / changelog drafted' },
      { label: 'Support/customer success briefed on changes', isRequired: false },
      { label: 'Maintenance banner or status page updated (if downtime expected)', isRequired: false },
    ],
  },
  {
    title: 'Documentation',
    items: [
      { label: 'README / internal docs updated', isRequired: false },
      { label: 'API docs updated (if endpoints changed)', isRequired: false },
      { label: 'Runbook updated with any new operational steps', isRequired: false },
    ],
  },
  {
    title: 'Final Go / No-Go',
    description: 'The gate. Nothing ships until every line here is signed off.',
    items: [
      { label: 'All above sections checked' },
      { label: 'Deployment owner identified' },
      { label: 'Rollback owner identified', environmentKeys: ['staging', 'production'] },
      {
        label: 'Go decision confirmed by team lead / release manager',
        evidenceRequired: true,
        environmentKeys: ['production'],
      },
    ],
  },
]

/** A short template for low-ceremony environments, so dev deploys aren't 49 items. */
export const QUICK_DEPLOY_SECTIONS: SeedSection[] = [
  {
    title: 'Pre-flight',
    items: [
      { label: 'CI is green' },
      { label: 'Branch is up to date with the base branch' },
      { label: 'Environment variables checked' },
    ],
  },
  {
    title: 'Deploy',
    items: [
      { label: 'Build succeeded' },
      { label: 'Smoke test passed after deploy' },
      { label: 'Errors checked for 5 minutes post-deploy' },
    ],
  },
]
