'use client'

import { ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'

export interface PermissionRow {
  key: string
  label: string
  description: string
  group: string
  groupLabel: string
  dangerous: boolean
  /** Organization-wide, versus applying only on assigned projects. */
  orgWide: boolean
}

interface Props {
  rows: readonly PermissionRow[]
  /** Permissions the currently ticked roles grant. */
  fromRoles: ReadonlySet<string>
  /** Granted by hand, on top of the roles. */
  extra: readonly string[]
  /** Withheld by hand, despite a role granting it. */
  revoked: readonly string[]
  disabled: boolean
  onToggle: (key: string) => void
}

/**
 * The permission list, grouped into collapsible sections, with each row saying
 * where it came from.
 *
 * A role is a template here, not the final word — so the interface has to explain
 * itself: an administrator needs to see that `deployment.create` is present *because
 * Engineer grants it*, and that a removal was deliberate rather than an absence.
 * Hence three visible states rather than a plain checkbox:
 *
 *   from role   granted because a ticked role includes it
 *   added       granted by hand; no role decides it
 *   removed     struck through — a role grants it and it was taken away
 *
 * Collapsing 50 rows must not hide those hand-set exceptions, which are exactly
 * what someone reviewing this account came to check. So every header carries its
 * counts — held, added, removed — and a group containing an override starts open.
 * The rest start closed: the summary line above the matrix already answers "how
 * much can they do", and the headers answer "where".
 */
export function UserPermissionMatrix({
  rows,
  fromRoles,
  extra,
  revoked,
  disabled,
  onToggle,
}: Props) {
  const grouped = new Map<string, PermissionRow[]>()
  for (const row of rows) {
    const list = grouped.get(row.group) ?? []
    list.push(row)
    grouped.set(row.group, list)
  }

  /**
   * Initialised once, not re-derived per render: groups springing open or shut
   * while an administrator is mid-edit would be hostile, so after mount the
   * disclosure state belongs entirely to their clicks.
   */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const withOverrides = new Set<string>()
    for (const row of rows) {
      if (extra.includes(row.key) || revoked.includes(row.key)) withOverrides.add(row.group)
    }
    return withOverrides
  })

  function toggleGroup(group: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {[...grouped.entries()].map(([group, groupRows]) => {
        const isOpen = open.has(group)
        const panelId = `permission-group-${group}`

        const held = groupRows.filter((row) => {
          if (revoked.includes(row.key)) return false
          return fromRoles.has(row.key) || extra.includes(row.key)
        }).length
        const added = groupRows.filter((row) => extra.includes(row.key)).length
        const removed = groupRows.filter((row) => revoked.includes(row.key)).length

        return (
          <div key={group} className="overflow-hidden rounded-lg border">
            <button
              type="button"
              onClick={() => toggleGroup(group)}
              aria-expanded={isOpen}
              aria-controls={panelId}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-muted/50"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {groupRows[0]?.groupLabel ?? group}
                </span>
                {/* The exceptions stay visible with the group closed — hiding a
                    deliberate removal behind a collapsed header would undo the
                    point of showing sources at all. */}
                {added > 0 && (
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                    {added} added
                  </Badge>
                )}
                {removed > 0 && (
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                    {removed} removed
                  </Badge>
                )}
              </span>

              <span className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {held}/{groupRows.length}
                </span>
                <ChevronRight
                  size={14}
                  aria-hidden
                  className={`text-muted-foreground transition-transform duration-200 ${
                    isOpen ? 'rotate-90' : ''
                  }`}
                />
              </span>
            </button>

            {/* `hidden` rather than conditional rendering, so checkbox state and
                scroll position survive a close/open round trip. */}
            <div id={panelId} hidden={!isOpen} className="space-y-1.5 border-t px-2 py-2">
              {groupRows.map((row) => {
                const isRevoked = revoked.includes(row.key)
                const isExtra = extra.includes(row.key)
                const roleGrants = fromRoles.has(row.key)
                const rowHeld = isRevoked ? false : roleGrants || isExtra

                return (
                  <label
                    key={row.key}
                    className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={rowHeld}
                      onChange={() => onToggle(row.key)}
                      disabled={disabled}
                      className="mt-1"
                    />

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span
                          className={`text-sm ${isRevoked ? 'text-muted-foreground line-through' : ''}`}
                        >
                          {row.label}
                        </span>

                        {isRevoked && (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                            removed
                          </Badge>
                        )}
                        {!isRevoked && roleGrants && (
                          <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                            from role
                          </Badge>
                        )}
                        {!isRevoked && !roleGrants && isExtra && (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                            added
                          </Badge>
                        )}
                        {row.dangerous && (
                          <Badge className="bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                            dangerous
                          </Badge>
                        )}
                        {!row.orgWide && (
                          <span
                            className="text-[10px] uppercase tracking-wide text-muted-foreground"
                            title="Applies only on the projects this user is assigned to"
                          >
                            per project
                          </span>
                        )}
                      </span>

                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {row.description}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
