'use client'

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
 * The permission list, grouped, with each row saying where it came from.
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
 * The catalog metadata driving this (`group`, `label`, `description`, `dangerous`)
 * has existed since the first release and nothing rendered it until now.
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

  return (
    <div className="space-y-5">
      {[...grouped.entries()].map(([group, groupRows]) => (
        <fieldset key={group} className="space-y-2">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {groupRows[0]?.groupLabel ?? group}
          </legend>

          <div className="space-y-1.5">
            {groupRows.map((row) => {
              const isRevoked = revoked.includes(row.key)
              const isExtra = extra.includes(row.key)
              const roleGrants = fromRoles.has(row.key)
              const held = isRevoked ? false : roleGrants || isExtra

              return (
                <label
                  key={row.key}
                  className="flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={held}
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
        </fieldset>
      ))}
    </div>
  )
}
