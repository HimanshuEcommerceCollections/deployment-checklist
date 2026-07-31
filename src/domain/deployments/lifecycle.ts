/**
 * The deployment state machine and the readiness gate.
 *
 * Pure by design — this is the one place that decides what a run may do next, so
 * it has to be testable without a database, and the UI has to be able to ask it
 * the same question the service enforces. A button that offers a transition the
 * service will refuse is worse than no button.
 *
 * The seven statuses come from `DeploymentStatus` in prisma/schema.prisma. Keep
 * the two in step: a status here that the schema does not have will not persist,
 * and a status there that is missing here can never be reached.
 *
 * ── Where the gate lives ────────────────────────────────────────────────────
 * `completionPolicy` is captured into `DeploymentRun.checklist` at creation,
 * alongside the sections. That is deliberate: editing a template's policy must
 * not change the bar for a release already in flight. `evaluateGate` therefore
 * takes the policy from the snapshot, never from TemplateVersion.
 */
import { PERMISSIONS } from '@/lib/authz/permissions'

export const DEPLOYMENT_STATUSES = [
  'DRAFT',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
] as const

export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number]

export const DEPLOYMENT_TRANSITIONS = [
  'start',
  'block',
  'unblock',
  'complete',
  'fail',
  'cancel',
  'rollback',
] as const

export type DeploymentTransition = (typeof DEPLOYMENT_TRANSITIONS)[number]

export interface TransitionRule {
  /** Statuses this transition may be applied from. */
  readonly from: readonly DeploymentStatus[]
  readonly to: DeploymentStatus
  readonly permission: string
  /** A reason is recorded on the run, so the history explains itself later. */
  readonly reasonRequired: boolean
  /** Whether the checklist gate has to pass first. */
  readonly gated: boolean
  /** Imperative label for the button. */
  readonly label: string
  /** Shown in the confirmation dialog. Present tense, says what changes. */
  readonly confirm: string
}

export const TRANSITION_RULES: Record<DeploymentTransition, TransitionRule> = {
  start: {
    from: ['DRAFT'],
    to: 'IN_PROGRESS',
    permission: PERMISSIONS.deployment.start,
    reasonRequired: false,
    gated: false,
    label: 'Start deployment',
    confirm: 'Starts the run and begins the clock. The checklist becomes the live record.',
  },
  /**
   * Block and unblock sit under `execute`, not `edit`. The people ticking items
   * are the ones who discover a blocker, and there is no separate block
   * permission in the catalog — `edit` is about version and release notes.
   */
  block: {
    from: ['IN_PROGRESS'],
    to: 'BLOCKED',
    permission: PERMISSIONS.deployment.execute,
    reasonRequired: true,
    gated: false,
    label: 'Block',
    confirm: 'Records the run as blocked. Items stay editable so work can continue.',
  },
  unblock: {
    from: ['BLOCKED'],
    to: 'IN_PROGRESS',
    permission: PERMISSIONS.deployment.execute,
    reasonRequired: false,
    gated: false,
    label: 'Unblock',
    confirm: 'Returns the run to in progress.',
  },
  complete: {
    from: ['IN_PROGRESS'],
    to: 'COMPLETED',
    permission: PERMISSIONS.deployment.complete,
    reasonRequired: false,
    gated: true,
    label: 'Complete deployment',
    confirm: 'Seals the run. The checklist becomes read-only and cannot be reopened.',
  },
  fail: {
    from: ['IN_PROGRESS', 'BLOCKED'],
    to: 'FAILED',
    permission: PERMISSIONS.deployment.fail,
    reasonRequired: true,
    gated: false,
    label: 'Mark as failed',
    confirm: 'Seals the run as failed. The checklist becomes read-only.',
  },
  /**
   * Cancel is reachable from DRAFT, where fail is not: a run that never started
   * cannot have failed, and conflating the two makes the history lie about how
   * often releases break.
   */
  cancel: {
    from: ['DRAFT', 'IN_PROGRESS', 'BLOCKED'],
    to: 'CANCELLED',
    permission: PERMISSIONS.deployment.cancel,
    reasonRequired: true,
    gated: false,
    label: 'Cancel',
    confirm: 'Abandons the run. The checklist becomes read-only.',
  },
  rollback: {
    from: ['COMPLETED'],
    to: 'ROLLED_BACK',
    permission: PERMISSIONS.deployment.rollback,
    reasonRequired: true,
    gated: false,
    label: 'Record rollback',
    confirm: 'Marks this completed release as rolled back. The record is kept as it stands.',
  },
}

/** A run in a terminal status is history: nothing but rollback can follow. */
export const TERMINAL_STATUSES: readonly DeploymentStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
]

/**
 * Statuses whose checklist is still writable.
 *
 * `updateDeploymentItem` had this inline as a string array; it belongs here so
 * the console, the service and the state machine cannot disagree about whether a
 * run is editable.
 */
export const EDITABLE_STATUSES: readonly DeploymentStatus[] = ['DRAFT', 'IN_PROGRESS', 'BLOCKED']

export function isTerminal(status: DeploymentStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

export function isEditable(status: DeploymentStatus): boolean {
  return EDITABLE_STATUSES.includes(status)
}

/** Transitions legal from a status, in the order a UI should present them. */
export function transitionsFrom(status: DeploymentStatus): DeploymentTransition[] {
  return DEPLOYMENT_TRANSITIONS.filter((name) => TRANSITION_RULES[name].from.includes(status))
}

export function canTransition(from: DeploymentStatus, transition: DeploymentTransition): boolean {
  return TRANSITION_RULES[transition].from.includes(from)
}

// ---------------------------------------------------------------------------
//  The readiness gate
// ---------------------------------------------------------------------------

export const COMPLETION_POLICIES = ['ALL_ITEMS', 'ALL_REQUIRED', 'MANUAL'] as const

export type CompletionPolicy = (typeof COMPLETION_POLICIES)[number]

/** Counters as DeploymentRun maintains them, denormalised alongside item writes. */
export interface GateCounters {
  totalItems: number
  totalRequired: number
  /** Checked OR skipped — a skipped item is accounted for. */
  completedItems: number
  completedRequired: number
}

export interface GateResult {
  passes: boolean
  /** How many items still stand between the run and completion. */
  outstanding: number
  policy: CompletionPolicy
  /** One sentence for the UI. Empty when the gate passes. */
  message: string
}

/**
 * An unrecognised or absent policy falls back to ALL_REQUIRED rather than
 * MANUAL. A snapshot written before the field existed, or by a future version
 * this code does not know, must not silently drop the gate on a production
 * release — failing safe means requiring more, not less.
 */
export function normalisePolicy(policy: string | null | undefined): CompletionPolicy {
  return COMPLETION_POLICIES.includes(policy as CompletionPolicy)
    ? (policy as CompletionPolicy)
    : 'ALL_REQUIRED'
}

export function evaluateGate(
  policy: string | null | undefined,
  counters: GateCounters,
): GateResult {
  const resolved = normalisePolicy(policy)

  if (resolved === 'MANUAL') {
    return { passes: true, outstanding: 0, policy: resolved, message: '' }
  }

  const outstanding =
    resolved === 'ALL_ITEMS'
      ? Math.max(0, counters.totalItems - counters.completedItems)
      : Math.max(0, counters.totalRequired - counters.completedRequired)

  if (outstanding === 0) {
    return { passes: true, outstanding: 0, policy: resolved, message: '' }
  }

  const noun = resolved === 'ALL_ITEMS' ? 'item' : 'required item'

  return {
    passes: false,
    outstanding,
    policy: resolved,
    message: `${outstanding} ${noun}${outstanding === 1 ? '' : 's'} still outstanding.`,
  }
}

/**
 * GO / HOLD, as the reference design's readout puts it.
 *
 * Deliberately not "percent === 100": under ALL_REQUIRED a run can read GO with
 * optional items unticked, which is the whole point of marking them optional.
 */
export function readiness(
  status: DeploymentStatus,
  policy: string | null | undefined,
  counters: GateCounters,
): 'GO' | 'HOLD' | 'SEALED' {
  if (isTerminal(status)) return 'SEALED'
  return evaluateGate(policy, counters).passes ? 'GO' : 'HOLD'
}

/**
 * Wall-clock time the run was live, or null when it never started.
 *
 * A run cancelled straight out of DRAFT has no startedAt, and reporting zero
 * there would drag every average duration down with releases that never ran.
 */
export function durationMs(startedAt: Date | null | undefined, endedAt: Date): number | null {
  if (!startedAt) return null
  return Math.max(0, endedAt.getTime() - startedAt.getTime())
}

/** "1h 12m" / "4m 30s" / "18s" — for emails and the run header. */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null

  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
