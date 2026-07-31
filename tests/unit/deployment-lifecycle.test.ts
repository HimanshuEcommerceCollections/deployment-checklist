import { describe, expect, it } from 'vitest'

import {
  DEPLOYMENT_STATUSES,
  DEPLOYMENT_TRANSITIONS,
  TRANSITION_RULES,
  canTransition,
  durationMs,
  evaluateGate,
  formatDuration,
  isEditable,
  isTerminal,
  normalisePolicy,
  readiness,
  transitionsFrom,
} from '@/domain/deployments/lifecycle'

const counters = (over: Partial<Parameters<typeof evaluateGate>[1]> = {}) => ({
  totalItems: 10,
  totalRequired: 4,
  completedItems: 0,
  completedRequired: 0,
  ...over,
})

describe('the transition table', () => {
  it('only ever targets a status the schema knows', () => {
    for (const name of DEPLOYMENT_TRANSITIONS) {
      const rule = TRANSITION_RULES[name]
      expect(DEPLOYMENT_STATUSES).toContain(rule.to)
      for (const from of rule.from) expect(DEPLOYMENT_STATUSES).toContain(from)
    }
  })

  it('never transitions a status to itself', () => {
    for (const name of DEPLOYMENT_TRANSITIONS) {
      const rule = TRANSITION_RULES[name]
      expect(rule.from).not.toContain(rule.to)
    }
  })

  it('leaves every terminal status closed except completed', () => {
    expect(transitionsFrom('FAILED')).toEqual([])
    expect(transitionsFrom('CANCELLED')).toEqual([])
    expect(transitionsFrom('ROLLED_BACK')).toEqual([])
    // Completed is terminal but a release can still be rolled back afterwards.
    expect(transitionsFrom('COMPLETED')).toEqual(['rollback'])
  })

  it('offers draft only start and cancel', () => {
    expect(transitionsFrom('DRAFT')).toEqual(['start', 'cancel'])
  })

  it('cannot fail a run that never started', () => {
    // Cancel is the honest verb for a draft; failing it would make the history
    // report releases as broken when they never ran.
    expect(canTransition('DRAFT', 'fail')).toBe(false)
    expect(canTransition('DRAFT', 'cancel')).toBe(true)
  })

  it('cannot complete a blocked run without unblocking it', () => {
    expect(canTransition('BLOCKED', 'complete')).toBe(false)
    expect(canTransition('BLOCKED', 'unblock')).toBe(true)
  })

  it('cannot restart or re-complete a sealed run', () => {
    expect(canTransition('COMPLETED', 'start')).toBe(false)
    expect(canTransition('COMPLETED', 'complete')).toBe(false)
    expect(canTransition('CANCELLED', 'start')).toBe(false)
  })

  it('requires a reason for every transition that ends badly', () => {
    expect(TRANSITION_RULES.fail.reasonRequired).toBe(true)
    expect(TRANSITION_RULES.cancel.reasonRequired).toBe(true)
    expect(TRANSITION_RULES.rollback.reasonRequired).toBe(true)
    expect(TRANSITION_RULES.block.reasonRequired).toBe(true)

    expect(TRANSITION_RULES.start.reasonRequired).toBe(false)
    expect(TRANSITION_RULES.complete.reasonRequired).toBe(false)
  })

  it('gates completion and nothing else', () => {
    const gated = DEPLOYMENT_TRANSITIONS.filter((n) => TRANSITION_RULES[n].gated)
    expect(gated).toEqual(['complete'])
  })
})

describe('editable and terminal statuses', () => {
  it('keeps the checklist writable through blocked', () => {
    // A blocker is discovered mid-run; the work does not stop.
    expect(isEditable('DRAFT')).toBe(true)
    expect(isEditable('IN_PROGRESS')).toBe(true)
    expect(isEditable('BLOCKED')).toBe(true)
  })

  it('seals the checklist in every terminal status', () => {
    for (const status of ['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK'] as const) {
      expect(isEditable(status)).toBe(false)
      expect(isTerminal(status)).toBe(true)
    }
  })

  it('partitions the statuses — every one is editable or terminal, never both', () => {
    for (const status of DEPLOYMENT_STATUSES) {
      expect(isEditable(status)).toBe(!isTerminal(status))
    }
  })
})

describe('the readiness gate', () => {
  it('ALL_REQUIRED ignores optional items', () => {
    const result = evaluateGate('ALL_REQUIRED', counters({ completedRequired: 4, completedItems: 4 }))

    // 6 optional items untouched, and the run is still good to go — which is
    // the entire point of marking an item optional.
    expect(result.passes).toBe(true)
    expect(result.outstanding).toBe(0)
  })

  it('ALL_ITEMS counts every item', () => {
    const result = evaluateGate('ALL_ITEMS', counters({ completedRequired: 4, completedItems: 4 }))

    expect(result.passes).toBe(false)
    expect(result.outstanding).toBe(6)
    expect(result.message).toBe('6 items still outstanding.')
  })

  it('MANUAL lets permission alone decide', () => {
    const result = evaluateGate('MANUAL', counters())

    expect(result.passes).toBe(true)
    expect(result.message).toBe('')
  })

  it('singularises the last outstanding item', () => {
    expect(evaluateGate('ALL_REQUIRED', counters({ completedRequired: 3 })).message).toBe(
      '1 required item still outstanding.',
    )
    expect(evaluateGate('ALL_ITEMS', counters({ completedItems: 9 })).message).toBe(
      '1 item still outstanding.',
    )
  })

  it('falls back to ALL_REQUIRED for an unknown or absent policy', () => {
    // Failing safe means requiring more, not less: a snapshot written before the
    // field existed must not drop the gate on a production release.
    for (const policy of [undefined, null, '', 'SOMETHING_NEW']) {
      expect(normalisePolicy(policy)).toBe('ALL_REQUIRED')
      expect(evaluateGate(policy, counters()).passes).toBe(false)
    }
  })

  it('never reports negative outstanding when counters run ahead', () => {
    // Defensive: a recount racing an item write could momentarily overshoot.
    const result = evaluateGate('ALL_REQUIRED', counters({ completedRequired: 9 }))

    expect(result.outstanding).toBe(0)
    expect(result.passes).toBe(true)
  })

  it('passes an empty checklist rather than deadlocking it', () => {
    const result = evaluateGate(
      'ALL_ITEMS',
      { totalItems: 0, totalRequired: 0, completedItems: 0, completedRequired: 0 },
    )

    expect(result.passes).toBe(true)
  })
})

describe('GO / HOLD / SEALED', () => {
  it('reads HOLD until the gate passes, then GO', () => {
    expect(readiness('IN_PROGRESS', 'ALL_REQUIRED', counters())).toBe('HOLD')
    expect(readiness('IN_PROGRESS', 'ALL_REQUIRED', counters({ completedRequired: 4 }))).toBe('GO')
  })

  it('reads GO with optional items outstanding under ALL_REQUIRED', () => {
    // The gauge would say 40%; the gate says go. Both are correct.
    expect(
      readiness('IN_PROGRESS', 'ALL_REQUIRED', counters({ completedRequired: 4, completedItems: 4 })),
    ).toBe('GO')
  })

  it('reads SEALED for anything terminal, gate or no gate', () => {
    expect(readiness('COMPLETED', 'ALL_REQUIRED', counters({ completedRequired: 4 }))).toBe('SEALED')
    expect(readiness('CANCELLED', 'ALL_REQUIRED', counters())).toBe('SEALED')
  })
})

describe('duration', () => {
  it('is null when the run never started', () => {
    expect(durationMs(null, new Date('2026-01-01T00:00:00Z'))).toBeNull()
    expect(durationMs(undefined, new Date('2026-01-01T00:00:00Z'))).toBeNull()
  })

  it('measures start to terminal state', () => {
    const started = new Date('2026-01-01T10:00:00Z')
    const ended = new Date('2026-01-01T11:12:30Z')

    expect(durationMs(started, ended)).toBe(4_350_000)
    expect(formatDuration(durationMs(started, ended))).toBe('1h 12m')
  })

  it('clamps a clock that went backwards to zero', () => {
    const started = new Date('2026-01-01T10:00:00Z')
    const ended = new Date('2026-01-01T09:59:00Z')

    expect(durationMs(started, ended)).toBe(0)
  })

  it('formats by the largest useful unit', () => {
    expect(formatDuration(18_000)).toBe('18s')
    expect(formatDuration(270_000)).toBe('4m 30s')
    expect(formatDuration(null)).toBeNull()
  })
})
