import 'server-only'

import {
  DEPLOYMENT_TRANSITIONS,
  type DeploymentStatus,
  type DeploymentTransition,
  TRANSITION_RULES,
  durationMs as computeDurationMs,
  evaluateGate,
  formatDuration,
  isEditable,
} from '@/domain/deployments/lifecycle'
import { PreconditionFailedError } from '@/domain/shared/errors'
import { type AuditAction, AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import {
  type RequestContext,
  can,
  projectFilter,
  requireAnyProject,
  requirePermission,
} from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { env } from '@/lib/config/env'
import { db } from '@/lib/db/prisma'
import { notifications } from '@/lib/notifications/dispatcher'
import type { NotificationTemplateKey } from '@/lib/notifications/types'

import type {
  CreateDeploymentInput,
  UpdateDeploymentItemInput,
  CreateCommentInput,
} from '../schemas/deployments.schema'

const AUDIT_FOR: Record<DeploymentTransition, AuditAction> = {
  start: AUDIT_ACTIONS.deployment.started,
  block: AUDIT_ACTIONS.deployment.blocked,
  unblock: AUDIT_ACTIONS.deployment.unblocked,
  complete: AUDIT_ACTIONS.deployment.completed,
  fail: AUDIT_ACTIONS.deployment.failed,
  cancel: AUDIT_ACTIONS.deployment.cancelled,
  rollback: AUDIT_ACTIONS.deployment.rolledBack,
}

/**
 * Block and unblock are deliberately absent: they are intra-run bookkeeping, and
 * emailing the project every time someone toggles a blocker trains people to
 * ignore the ones that matter. The audit trail still records them.
 */
const NOTIFY_FOR: Partial<Record<DeploymentTransition, NotificationTemplateKey>> = {
  start: 'deployment-started',
  complete: 'deployment-completed',
  fail: 'deployment-failed',
  cancel: 'deployment-cancelled',
  rollback: 'deployment-rolled-back',
}

/**
 * Projects the caller may act on. Applied to every read and write, so a valid id
 * from a project they cannot see is still a miss.
 *
 * Was `memberships: { some: { userId } }`, which ignored permissions and could not
 * honour the super-admin short-circuit that lives in `can()` — see docs/14 §14.1.
 * Now derived from the permission the caller actually needs.
 *
 * The scope goes in `AND` rather than being spread at the top level because
 * callers add their own `id`, and a spread `{ id: { in: [...] } }` would silently
 * replace it — turning "this project, if permitted" into "any permitted project".
 */
function visibleProject(ctx: RequestContext, permission: string) {
  return {
    organizationId: ctx.organizationId,
    deletedAt: null,
    AND: [projectFilter(ctx, permission, 'id')],
  }
}

export class DeploymentsService {
  async listProjectDeployments(ctx: RequestContext, projectId: string) {
    /// The project is named, so check it exactly — an unscoped check would reject
    /// anyone whose access to it came from a project assignment.
    requirePermission(ctx, PERMISSIONS.deployment.read, { projectId })

    return db.deploymentRun.findMany({
      where: {
        projectId,
        project: visibleProject(ctx, PERMISSIONS.deployment.read),
        deletedAt: null,
      },
      include: {
        environment: true,
        _count: { select: { itemStates: true, comments: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async getDeployment(ctx: RequestContext, id: string) {
    /// Which project this run belongs to is not known until it is read, so the
    /// coarse gate goes here and `visibleProject` below does the exact scoping —
    /// an id outside their projects then misses, which is the right 404.
    requireAnyProject(ctx, PERMISSIONS.deployment.read)

    return db.deploymentRun.findFirstOrThrow({
      where: {
        id,
        project: visibleProject(ctx, PERMISSIONS.deployment.read),
        deletedAt: null,
      },
      include: {
        project: true,
        environment: true,
        itemStates: { orderBy: [{ sectionId: 'asc' }, { order: 'asc' }] },
        comments: {
          where: { deletedAt: null },
          include: { author: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        },
      },
    })
  }

  async createDeployment(ctx: RequestContext, input: CreateDeploymentInput) {
    /// The project is named in the input, so the check is exact. Unscoped, it would
    /// refuse every project-assigned user before the visibility filter below runs.
    requirePermission(ctx, PERMISSIONS.deployment.create, { projectId: input.projectId })

    const project = await db.project.findFirstOrThrow({
      where: { id: input.projectId, ...visibleProject(ctx, PERMISSIONS.deployment.create) },
      select: { id: true, key: true, environmentIds: true },
    })

    const version = await db.templateVersion.findFirstOrThrow({
      where: {
        id: input.templateVersionId,
        status: 'PUBLISHED',
        deletedAt: null,
        template: { organizationId: ctx.organizationId, deletedAt: null },
      },
      include: { template: { select: { id: true, key: true, name: true } } },
    })

    const environment = await db.environment.findFirstOrThrow({
      where: { id: input.environmentId, organizationId: ctx.organizationId, deletedAt: null },
    })

    if (project.environmentIds.length > 0 && !project.environmentIds.includes(environment.id)) {
      throw new Error(`${project.key} is not allowed to deploy to ${environment.name}.`)
    }

    if (environment.isProduction) {
      requirePermission(ctx, PERMISSIONS.deployment.production, { projectId: project.id })
    }

    // Freeze the template content. Nothing in the execution path reads
    // TemplateVersion again — that is the point of the snapshot.
    const liveSections = version.sections
      .filter((s) => !s.deletedAt)
      .sort((a, b) => a.order - b.order)
      .map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        order: s.order,
        sourceSectionId: s.id,
        items: s.items
          .filter((i) => !i.deletedAt)
          .filter(
            (i) => i.environmentKeys.length === 0 || i.environmentKeys.includes(environment.key),
          )
          .sort((a, b) => a.order - b.order)
          .map((i) => ({
            id: i.id,
            label: i.label,
            helpText: i.helpText,
            order: i.order,
            isRequired: i.isRequired,
            evidenceRequired: i.evidenceRequired,
            ownerRoleKey: i.ownerRoleKey,
            metadata: i.metadata ?? undefined,
            sourceItemId: i.id,
          })),
      }))
      .filter((s) => s.items.length > 0)

    const flatItems = liveSections.flatMap((s) => s.items.map((i) => ({ ...i, sectionId: s.id })))

    if (flatItems.length === 0) {
      throw new Error('The selected template version has no items for this environment.')
    }

    // Sequence is per project and must be unique — derive it from the current max
    // rather than a count, so soft-deleted runs cannot cause a collision.
    const latest = await db.deploymentRun.findFirst({
      where: { projectId: project.id },
      select: { sequence: true },
      orderBy: { sequence: 'desc' },
    })
    const sequence = (latest?.sequence ?? 0) + 1

    const deployment = await db.deploymentRun.create({
      data: {
        organizationId: ctx.organizationId,
        projectId: project.id,
        reference: `${project.key}-${sequence}`,
        sequence,
        templateId: version.template.id,
        templateVersionId: version.id,
        checklist: {
          templateId: version.template.id,
          templateVersionId: version.id,
          templateKey: version.template.key,
          templateName: version.template.name,
          version: version.version,
          completionPolicy: version.completionPolicy,
          capturedAt: new Date(),
          sections: liveSections,
        },
        environmentId: environment.id,
        environmentKey: environment.key,
        environmentName: environment.name,
        isProduction: environment.isProduction,
        version: input.version,
        title: input.title || null,
        releaseNotes: input.releaseNotes || null,
        scheduledAt: input.scheduledAt || null,
        status: 'DRAFT',
        totalItems: flatItems.length,
        totalRequired: flatItems.filter((i) => i.isRequired).length,
        searchText: [input.version, input.title, project.key, environment.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
        createdById: ctx.actorId,
      },
    })

    await db.checklistItemState.createMany({
      data: flatItems.map((i) => ({
        organizationId: ctx.organizationId,
        deploymentId: deployment.id,
        sectionId: i.sectionId,
        itemId: i.id,
        order: i.order,
        isRequired: i.isRequired,
      })),
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.deployment.created, {
      entityType: 'DeploymentRun',
      entityId: deployment.id,
      entityLabel: deployment.reference,
    })

    return deployment
  }

  async updateDeploymentItem(
    ctx: RequestContext,
    deploymentId: string,
    itemId: string,
    input: UpdateDeploymentItemInput,
  ) {
    /// Coarse: the run's project is not known until it is read. The query below
    /// carries the precise check.
    requireAnyProject(ctx, PERMISSIONS.deployment.execute)

    // Scoped by deployment AND project visibility so an id from a project the
    // caller cannot execute in is still a miss.
    const deployment = await db.deploymentRun.findFirstOrThrow({
      where: {
        id: deploymentId,
        project: visibleProject(ctx, PERMISSIONS.deployment.execute),
        deletedAt: null,
      },
      select: { id: true, status: true, checklist: true },
    })

    /// The list of editable statuses lives in the state machine so the console,
    /// this service and the transition rules cannot drift apart.
    if (!isEditable(deployment.status as DeploymentStatus)) {
      throw new PreconditionFailedError('RUN_NOT_IN_PROGRESS', { status: deployment.status })
    }

    const current = await db.checklistItemState.findFirstOrThrow({
      where: { deploymentId: deployment.id, itemId },
    })

    if (input.revision !== undefined && input.revision !== current.revision) {
      throw new Error('This item was changed by someone else. Reload and try again.')
    }

    const snapshotItem = deployment.checklist.sections
      .flatMap((s) => s.items)
      .find((i) => i.id === itemId)

    if (input.checked && snapshotItem?.evidenceRequired) {
      const note = input.note ?? current.note
      if (!note) {
        throw new Error(`"${snapshotItem.label}" requires a note as evidence.`)
      }
    }

    const item = await db.checklistItemState.update({
      where: { id: current.id },
      data: {
        checked: input.checked,
        skipped: input.skipped,
        note: input.note ?? current.note,
        checkedById: input.checked ? ctx.actorId : null,
        checkedByName: input.checked ? ctx.actorName : null,
        checkedAt: input.checked ? new Date() : null,
        revision: { increment: 1 },
        toggleCount: { increment: 1 },
      },
    })

    // Counters are denormalised on DeploymentRun so lists never aggregate.
    const [completedItems, completedRequired] = await Promise.all([
      db.checklistItemState.count({
        where: { deploymentId: deployment.id, OR: [{ checked: true }, { skipped: true }] },
      }),
      db.checklistItemState.count({
        where: {
          deploymentId: deployment.id,
          isRequired: true,
          OR: [{ checked: true }, { skipped: true }],
        },
      }),
    ])

    await db.deploymentRun.update({
      where: { id: deployment.id },
      data: { completedItems, completedRequired, updatedById: ctx.actorId },
    })

    await audit.record(
      db,
      ctx,
      input.checked ? AUDIT_ACTIONS.deployment.itemChecked : AUDIT_ACTIONS.deployment.itemUnchecked,
      {
        entityType: 'ChecklistItemState',
        entityId: item.id,
        entityLabel: snapshotItem?.label ?? itemId,
      },
    )

    return item
  }

  /**
   * What this actor may do to this run, right now.
   *
   * The console renders straight from this rather than deciding for itself, so a
   * button can never offer a transition `transition()` would refuse. Anything
   * unavailable is returned with the reason instead of being dropped — "Complete
   * deployment · 3 required items outstanding" tells you what to do next, where a
   * missing button tells you nothing.
   */
  availableTransitions(
    ctx: RequestContext,
    run: {
      status: string
      projectId: string
      isProduction: boolean
      totalItems: number
      totalRequired: number
      completedItems: number
      completedRequired: number
      checklist: unknown
    },
  ) {
    const status = run.status as DeploymentStatus
    const policy = (run.checklist as { completionPolicy?: string } | null)?.completionPolicy
    const gate = evaluateGate(policy, run)

    return DEPLOYMENT_TRANSITIONS.filter((name) =>
      TRANSITION_RULES[name].from.includes(status),
    ).map((name) => {
      const rule = TRANSITION_RULES[name]

      const permitted = can(ctx, rule.permission, {
        projectId: run.projectId,
        isProductionEnvironment: run.isProduction,
      })

      const unavailable = !permitted
        ? run.isProduction && !can(ctx, PERMISSIONS.deployment.production, { projectId: run.projectId })
          ? 'Production releases need the Deploy to production permission.'
          : 'You do not have permission for this.'
        : rule.gated && !gate.passes
          ? gate.message
          : null

      return {
        name,
        label: rule.label,
        confirm: rule.confirm,
        reasonRequired: rule.reasonRequired,
        available: unavailable === null,
        unavailable,
      }
    })
  }

  /**
   * The one door for every status change.
   *
   * A method per verb would mean seven copies of the same six steps — permission,
   * legality, gate, conditional write, audit, notify — and the copies drift. The
   * rules live in the state machine; this applies them.
   *
   * Ordering matters and is not arbitrary:
   *   permission → legality → gate → write
   * Checking the gate before the permission would tell an unauthorised caller how
   * much of someone else's checklist is outstanding.
   */
  async transition(
    ctx: RequestContext,
    deploymentId: string,
    name: DeploymentTransition,
    options: { reason?: string } = {},
  ) {
    const rule = TRANSITION_RULES[name]

    const run = await db.deploymentRun.findFirstOrThrow({
      where: {
        id: deploymentId,
        project: visibleProject(ctx, PERMISSIONS.deployment.read),
        deletedAt: null,
      },
      select: {
        id: true,
        reference: true,
        projectId: true,
        status: true,
        isProduction: true,
        environmentName: true,
        version: true,
        startedAt: true,
        totalItems: true,
        totalRequired: true,
        completedItems: true,
        completedRequired: true,
        checklist: true,
        createdById: true,
        project: { select: { name: true } },
      },
    })

    /**
     * `isProductionEnvironment` makes can() require deployment.production on top
     * of the transition's own permission. That is what stops an engineer who may
     * complete a staging run from sealing a production one, with no code change —
     * and it applies to every verb here, not just create.
     */
    requirePermission(ctx, rule.permission, {
      projectId: run.projectId,
      isProductionEnvironment: run.isProduction,
    })

    const from = run.status as DeploymentStatus
    if (!rule.from.includes(from)) {
      throw new PreconditionFailedError('ILLEGAL_TRANSITION', {
        status: from,
        attempted: name,
        allowedFrom: rule.from,
      })
    }

    const reason = options.reason?.trim()
    if (rule.reasonRequired && !reason) {
      throw new PreconditionFailedError('ILLEGAL_TRANSITION', {
        status: from,
        attempted: name,
        missing: 'reason',
      })
    }

    const snapshot = run.checklist as { completionPolicy?: string }

    if (rule.gated) {
      const gate = evaluateGate(snapshot.completionPolicy, run)
      if (!gate.passes) {
        // `details` carries the numbers so the UI names what is outstanding
        // rather than saying "not allowed" and leaving people hunting.
        throw new PreconditionFailedError('CHECKLIST_INCOMPLETE', {
          outstanding: gate.outstanding,
          policy: gate.policy,
          message: gate.message,
        })
      }
    }

    const now = new Date()
    const elapsed = computeDurationMs(run.startedAt, now)

    const updated = await db.$transaction(async (tx) => {
      /**
       * Conditional on the status we validated against, so two people pressing
       * Complete at the same moment cannot both win. `count === 0` means the run
       * moved underneath us — the same guard `revision` gives item writes.
       */
      const { count } = await tx.deploymentRun.updateMany({
        where: { id: run.id, status: from },
        data: {
          status: rule.to,
          updatedById: ctx.actorId,
          ...this.transitionColumns(name, ctx, now, elapsed, reason),
        },
      })

      if (count === 0) {
        throw new PreconditionFailedError('ILLEGAL_TRANSITION', {
          status: from,
          attempted: name,
          concurrent: true,
        })
      }

      await audit.record(tx, ctx, AUDIT_FOR[name], {
        entityType: 'DeploymentRun',
        entityId: run.id,
        entityLabel: run.reference,
        projectId: run.projectId,
        deploymentId: run.id,
        metadata: {
          from,
          to: rule.to,
          ...(reason ? { reason } : {}),
          ...(elapsed !== null ? { durationMs: elapsed } : {}),
        },
        summary: `${ctx.actorName} ${pastTense(name)} ${run.reference}${reason ? ` — ${reason}` : ''}`,
      })

      const templateKey = NOTIFY_FOR[name]
      if (templateKey) {
        const recipients = await this.notifyList(tx, run.projectId, run.createdById)

        if (recipients.length > 0) {
          await notifications.enqueue(
            {
              templateKey,
              organizationId: ctx.organizationId,
              // One email per run per transition, however many times the
              // enclosing request is retried.
              idempotencyKey: `run-${name}:${run.id}`,
              recipients,
              payload: {
                reference: run.reference,
                projectName: run.project.name,
                version: run.version,
                environmentName: run.environmentName,
                completedItems: run.completedItems,
                totalItems: run.totalItems,
                durationLabel: formatDuration(elapsed),
                actorName: ctx.actorName,
                reason: reason ?? null,
                url: `${env.APP_URL}/projects/${run.projectId}/deployments/${run.id}`,
              },
              relatedEntityType: 'DeploymentRun',
              relatedEntityId: run.id,
            },
            tx,
          )
        }
      }

      return tx.deploymentRun.findFirstOrThrow({ where: { id: run.id } })
    })

    return updated
  }

  /**
   * The per-transition columns. The schema gives each outcome its own trio of
   * timestamp, actor and reason rather than one generic pair, so history reads
   * without having to know the status vocabulary.
   */
  private transitionColumns(
    name: DeploymentTransition,
    ctx: RequestContext,
    now: Date,
    elapsed: number | null,
    reason?: string,
  ) {
    switch (name) {
      case 'start':
        return { startedAt: now, startedById: ctx.actorId, startedByName: ctx.actorName }

      case 'complete':
        return {
          completedAt: now,
          completedById: ctx.actorId,
          completedByName: ctx.actorName,
          durationMs: elapsed,
        }

      case 'fail':
        return {
          failedAt: now,
          failedById: ctx.actorId,
          failureReason: reason ?? null,
          durationMs: elapsed,
        }

      case 'cancel':
        return {
          cancelledAt: now,
          cancelledById: ctx.actorId,
          cancelReason: reason ?? null,
          durationMs: elapsed,
        }

      case 'rollback':
        /// durationMs was written when the run completed and describes the
        /// release, not the rollback. Overwriting it here would lose that.
        return { rolledBackAt: now, rolledBackById: ctx.actorId, rollbackReason: reason ?? null }

      case 'block':
      case 'unblock':
        /// No blockedAt column exists — the audit entry is the record, which is
        /// also what the run timeline will read in Phase 5.
        return {}
    }
  }

  /**
   * Who hears about a run changing state.
   *
   * Project members plus whoever created the run, deduplicated by email. The
   * creator is not decoration: visibility comes from permissions rather than
   * Membership rows since docs/14, so a project can legitimately have no members
   * and a members-only list would email nobody.
   */
  private async notifyList(
    reader: Pick<typeof db, 'membership'>,
    projectId: string,
    createdById: string,
  ) {
    const memberships = await reader.membership.findMany({
      where: { projectId, deletedAt: null },
      select: { user: { select: { id: true, name: true, email: true, status: true } } },
    })

    const creator = await db.user.findFirst({
      where: { id: createdById, deletedAt: null },
      select: { id: true, name: true, email: true, status: true },
    })

    const byEmail = new Map<string, { email: string; name: string; userId: string }>()

    for (const candidate of [...memberships.map((m) => m.user), creator]) {
      // Never mail a suspended or deactivated account — they cannot open the link.
      if (!candidate?.email || candidate.status !== 'ACTIVE') continue
      byEmail.set(candidate.email, {
        email: candidate.email,
        name: candidate.name,
        userId: candidate.id,
      })
    }

    return [...byEmail.values()]
  }

  async addComment(ctx: RequestContext, deploymentId: string, input: CreateCommentInput) {
    /// Coarse for the same reason as getDeployment; visibleProject scopes it.
    requireAnyProject(ctx, PERMISSIONS.comment.create)

    const deployment = await db.deploymentRun.findFirstOrThrow({
      where: {
        id: deploymentId,
        project: visibleProject(ctx, PERMISSIONS.comment.create),
        deletedAt: null,
      },
      select: { id: true, projectId: true },
    })

    const comment = await db.deploymentComment.create({
      data: {
        organizationId: ctx.organizationId,
        deploymentId: deployment.id,
        authorId: ctx.actorId,
        authorName: ctx.actorName,
        body: input.body,
        itemId: input.itemId || null,
        parentId: input.parentId || null,
      },
      include: { author: { select: { id: true, name: true, email: true } } },
    })

    await db.deploymentRun.update({
      where: { id: deployment.id },
      data: { commentCount: { increment: 1 } },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.deployment.commentAdded, {
      entityType: 'DeploymentComment',
      entityId: comment.id,
      entityLabel: comment.body.slice(0, 80),
      projectId: deployment.projectId,
      deploymentId: deployment.id,
    })

    /// projectId rides along so the caller can revalidate the run's route, which
    /// is nested under the project.
    return { ...comment, projectId: deployment.projectId }
  }
}

/** For audit summaries: "Priya completed APEX-142". */
function pastTense(name: DeploymentTransition): string {
  switch (name) {
    case 'start':
      return 'started'
    case 'block':
      return 'blocked'
    case 'unblock':
      return 'unblocked'
    case 'complete':
      return 'completed'
    case 'fail':
      return 'marked as failed'
    case 'cancel':
      return 'cancelled'
    case 'rollback':
      return 'recorded a rollback of'
  }
}

export const deploymentsService = new DeploymentsService()
