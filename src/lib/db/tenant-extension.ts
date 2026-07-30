import { Prisma } from '@prisma/client'

import { getCurrentOrganizationId } from '@/server/als'

/**
 * Automatic tenant scoping.
 *
 * Multi-organization is on the roadmap, and retrofitting tenancy into a live
 * system is one of the most expensive migrations there is — every collection
 * needs a backfill and every query needs auditing, with a cross-tenant leak
 * until the last one is found. So organizationId is present from commit one and
 * injected here rather than trusted to discipline.
 *
 * Reads  → organizationId appended to `where`
 * Writes → organizationId injected into `data` when absent
 *
 * Background jobs, the seed, and the migration runner run outside the request
 * scope (no ALS store), so nothing is injected and they pass organizationId
 * explicitly. That is deliberate: a cron job must be able to work across
 * tenants, and silently scoping it to "whatever the last request was" would be
 * far worse than requiring the explicit argument.
 */
const TENANT_MODELS = new Set<string>([
  'Setting',
  'Environment',
  'User',
  'Role',
  'Membership',
  'Invitation',
  'Project',
  'ChecklistTemplate',
  'TemplateVersion',
  'ProjectTemplate',
  'DeploymentRun',
  'ChecklistItemState',
  'DeploymentComment',
  'AuditLog',
  'NotificationOutbox',
  'DeploymentDailyStat',
])

/** Operations whose args carry a `where` we should narrow. */
const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
])

/** Operations whose args carry a `data` we should stamp. */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn'])

export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const organizationId = getCurrentOrganizationId()

        // No request scope (job/seed/migration) or an untracked model → pass through.
        if (!organizationId || !TENANT_MODELS.has(model)) {
          return query(args)
        }

        const typedArgs = args as Record<string, unknown>

        if (READ_OPERATIONS.has(operation)) {
          const where = (typedArgs.where ?? {}) as Record<string, unknown>
          // An explicit organizationId from the caller wins — cross-tenant reads
          // are legitimate for a super-admin tool, but must be deliberate.
          if (!('organizationId' in where)) {
            return query({ ...typedArgs, where: { ...where, organizationId } })
          }
          return query(args)
        }

        if (CREATE_OPERATIONS.has(operation)) {
          const data = typedArgs.data

          if (Array.isArray(data)) {
            return query({
              ...typedArgs,
              data: data.map((row: Record<string, unknown>) =>
                'organizationId' in row ? row : { ...row, organizationId },
              ),
            })
          }

          if (data && typeof data === 'object') {
            const row = data as Record<string, unknown>
            if (!('organizationId' in row)) {
              return query({ ...typedArgs, data: { ...row, organizationId } })
            }
          }
          return query(args)
        }

        /**
         * update / delete / upsert by unique id are NOT narrowed.
         *
         * Prisma restricts their `where` to unique fields, so organizationId
         * cannot be appended. Tenant safety on those paths comes from the
         * service layer, which always loads the row with a scoped findFirst
         * before mutating it — the pattern every service in this codebase uses.
         */
        return query(args)
      },
    },
  },
})

export { TENANT_MODELS }
