import 'server-only'

import { db } from '@/lib/db/prisma'

const SECTIONS = [
  {
    title: "Code & Review",
    items: [
      "All code merged to the release branch (main / release/x.x)",
      "Pull request(s) approved by required reviewers",
      "No unresolved review comments or blocking TODOs",
      "Linting and static analysis pass with no new warnings",
      "Dependency versions locked (lockfile committed, no 'latest' tags)",
      "No secrets, API keys, or debug code left in the codebase"
    ]
  },
  {
    title: "Testing",
    items: [
      "Unit tests pass (CI green)",
      "Integration tests pass",
      "End-to-end / smoke tests pass on staging",
      "Manual QA sign-off on critical user flows",
      "Load/performance testing done (if traffic-sensitive change)",
      "Edge cases and error states verified"
    ]
  },
  {
    title: "Security",
    items: [
      "Dependency vulnerability scan run (npm audit, Snyk, Dependabot)",
      "No hardcoded credentials or tokens",
      "Auth/permissions changes reviewed",
      "HTTPS/TLS enforced where applicable",
      "Input validation & sanitization checked for new endpoints"
    ]
  },
  {
    title: "Database & Data",
    items: [
      "Migrations tested on a staging copy of production data",
      "Migrations are backward-compatible during rollout",
      "Backup taken immediately before migration runs",
      "Rollback script/plan for migrations prepared",
      "Data seed/config changes documented"
    ]
  },
  {
    title: "Configuration & Environment",
    items: [
      "Environment variables set correctly for target environment",
      "Feature flags configured (on/off as intended)",
      "Secrets rotated/updated in vault or secrets manager",
      "Config diffs between staging and production reviewed",
      "Third-party service keys/quotas confirmed (payment, email, etc.)"
    ]
  },
  {
    title: "Infrastructure",
    items: [
      "Build artifacts/images created and tagged with version number",
      "Auto-scaling / resource limits reviewed for expected load",
      "CDN/cache invalidation plan ready (if static assets changed)",
      "DNS/load balancer changes reviewed (if applicable)",
      "Health checks and readiness probes configured"
    ]
  },
  {
    title: "Monitoring & Rollback",
    items: [
      "Logging in place for new features/changes",
      "Alerts/dashboards updated for new metrics or endpoints",
      "Error tracking (e.g. Sentry) configured for new code paths",
      "Rollback plan documented and tested",
      "Owner assigned to watch metrics post-deploy"
    ]
  },
  {
    title: "Communication",
    items: [
      "Deployment window scheduled and communicated to team",
      "Stakeholders notified of user-facing changes",
      "Release notes / changelog drafted",
      "Support/customer success briefed on changes",
      "Maintenance banner or status page updated (if downtime expected)"
    ]
  },
  {
    title: "Documentation",
    items: [
      "README / internal docs updated",
      "API docs updated (if endpoints changed)",
      "Runbook updated with any new operational steps"
    ]
  },
  {
    title: "Final Go / No-Go",
    items: [
      "All above sections checked",
      "Deployment owner identified",
      "Rollback owner identified",
      "Go decision confirmed by team lead / release manager"
    ]
  }
]

export async function seedDeploymentTemplate(orgId: string, userId: string) {
  try {
    const existing = await db.checklistTemplate.findFirst({
      where: {
        organizationId: orgId,
        name: "Pre-Deployment Checklist",
        deletedAt: null,
      },
    })

    if (existing) return existing

    const template = await db.checklistTemplate.create({
      data: {
        organizationId: orgId,
        name: "Pre-Deployment Checklist",
        description: "Comprehensive pre-deployment checklist covering code, testing, security, infrastructure, and more.",
        createdById: userId,
        versions: {
          create: {
            versionNumber: 1,
            status: "PUBLISHED",
            publishedById: userId,
            publishedAt: new Date(),
            createdById: userId,
            sections: {
              create: SECTIONS.map((section, sIdx) => ({
                title: section.title,
                order: sIdx,
                createdById: userId,
                items: {
                  create: section.items.map((itemTitle, iIdx) => ({
                    title: itemTitle,
                    order: iIdx,
                    requiresEvidence: false,
                    createdById: userId,
                  })),
                },
              })),
            },
          },
        },
      },
      include: {
        versions: {
          include: {
            sections: {
              include: { items: true },
            },
          },
        },
      },
    })

    return template
  } catch (error) {
    console.error("Failed to seed deployment template:", error)
    throw error
  }
}
