/**
 * The shape of `DeploymentRun.checklist` — template content frozen in at
 * creation.
 *
 * Prisma types this as `Json`, so every reader has to assert it. Both the
 * deployment detail page and the checklist page do, and when each declared its
 * own shape they drifted: one read `item.title` where the writer had put `label`.
 * One definition, imported by both, is what stops that.
 *
 * The writer is `DeploymentsService.createDeployment`. Change this and change
 * that together.
 */
export interface SnapshotItem {
  /** Snapshot item id. `ChecklistItemState.itemId` joins on this. */
  id: string
  label: string
  helpText?: string | null
  order: number
  isRequired: boolean
  evidenceRequired?: boolean
  ownerRoleKey?: string | null
}

export interface SnapshotSection {
  id: string
  title: string
  description?: string | null
  order: number
  items: SnapshotItem[]
}

export interface ChecklistSnapshot {
  templateId?: string
  templateVersionId?: string
  templateKey?: string
  templateName?: string
  version?: number
  completionPolicy?: string
  sections?: SnapshotSection[]
}

/** Per-item state as the pages consume it. */
export interface ItemStateLike {
  itemId: string
  checked: boolean
  skipped: boolean
  isRequired: boolean
  note?: string | null
  checkedByName?: string | null
  checkedAt?: Date | null
}

/** Totals every view of a run agrees on. A skipped item is accounted for. */
export function summarise(states: readonly ItemStateLike[]) {
  const total = states.length
  const accounted = states.filter((s) => s.checked || s.skipped).length
  const requiredOutstanding = states.filter(
    (s) => s.isRequired && !s.checked && !s.skipped,
  ).length

  return {
    total,
    accounted,
    requiredOutstanding,
    percent: total > 0 ? Math.round((accounted / total) * 100) : 0,
  }
}

/** Ordered sections with their state joined on, for rendering. */
export function joinSnapshot(snapshot: ChecklistSnapshot, states: readonly ItemStateLike[]) {
  const byItemId = new Map(states.map((state) => [state.itemId, state]))

  return [...(snapshot.sections ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((section) => {
      const items = [...(section.items ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((item) => {
          const state = byItemId.get(item.id)
          return {
            id: item.id,
            label: item.label,
            helpText: item.helpText,
            isRequired: item.isRequired,
            checked: state?.checked ?? false,
            skipped: state?.skipped ?? false,
            note: state?.note ?? null,
            checkedByName: state?.checkedByName ?? null,
            checkedAt: state?.checkedAt ?? null,
          }
        })

      return {
        id: section.id,
        title: section.title,
        description: section.description,
        items,
        accounted: items.filter((i) => i.checked || i.skipped).length,
      }
    })
}
