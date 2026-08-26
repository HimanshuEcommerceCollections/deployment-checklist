'use client'

import { ChevronRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { updateDeploymentItem } from '../actions/deployments.actions'

export interface ChecklistItem {
  /** Snapshot item id — what the toggle mutation keys on. */
  id: string
  label: string
  helpText?: string | null
  isRequired: boolean
  /** Requires a note before it can be checked — the server refuses otherwise. */
  evidenceRequired?: boolean
  checked: boolean
  skipped?: boolean
  note?: string | null
  checkedByName?: string | null
  checkedAt?: Date | string | null
  /** Optimistic-concurrency counter the toggle asserts on. */
  revision?: number
}

interface DeploymentSectionPanelProps {
  index: number
  title: string
  description?: string | null
  items: ChecklistItem[]
  deploymentId: string
  /** COMPLETED runs are sealed — the server refuses edits, so do not offer them. */
  readOnly?: boolean
}

export function DeploymentSectionPanel({
  index,
  title,
  description,
  items,
  deploymentId,
  readOnly = false,
}: DeploymentSectionPanelProps) {
  const router = useRouter()
  const [open, setOpen] = useState(index === 0)
  const [, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Optimistic overrides, keyed by item id.
   *
   * `checked` used to be read straight from props. Since the props come from a
   * Server Component they do not change until the route re-renders, so React
   * reset the controlled checkbox to its old value the moment the click
   * finished — the tick visibly bounced back even though the write had
   * succeeded. This holds the new value until `router.refresh()` brings the
   * server's version back.
   */
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})

  /**
   * Draft note text per item, for evidence-required items. Seeded lazily from the
   * saved note on first edit so an existing note is not wiped when the box opens.
   */
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({})

  const isChecked = (item: ChecklistItem) => optimistic[item.id] ?? item.checked
  const draftFor = (item: ChecklistItem) => noteDraft[item.id] ?? item.note ?? ''

  const checkedCount = items.filter((item) => isChecked(item) || item.skipped).length
  const progressPercent = items.length > 0 ? (checkedCount / items.length) * 100 : 0

  const handleToggle = async (item: ChecklistItem, checked: boolean) => {
    // Evidence-required items cannot be ticked without a note — the server
    // enforces this, so catch it here rather than letting the tick bounce back.
    const note = draftFor(item).trim()
    if (checked && item.evidenceRequired && !note) {
      setError(`"${item.label}" needs a note before it can be checked.`)
      return
    }

    setPendingId(item.id)
    setError(null)
    setOptimistic((prev) => ({ ...prev, [item.id]: checked }))

    try {
      const result = await updateDeploymentItem(deploymentId, item.id, {
        checked,
        skipped: false,
        // Only send a note when there is one — an empty string would overwrite a
        // note left by someone else when merely un-ticking an item.
        ...(note ? { note } : {}),
        ...(item.revision !== undefined ? { revision: item.revision } : {}),
      })

      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        // Roll the optimistic value back — the server rejected it. Evidence still
        // missing, a stale revision (someone else edited first), or a sealed run.
        setOptimistic((prev) => ({ ...prev, [item.id]: !checked }))
        const message = (result as { message?: string }).message
        const code = (result as { code?: string }).code
        setError(message ?? 'Could not update that item.')
        // A CONFLICT on this action can only be a stale revision — pull the
        // latest state so the next attempt sends the current revision.
        if (code === 'CONFLICT') startTransition(() => router.refresh())
        return
      }

      startTransition(() => router.refresh())
    } catch {
      setOptimistic((prev) => ({ ...prev, [item.id]: !checked }))
      setError('Could not reach the server. Your tick was not saved.')
    } finally {
      setPendingId(null)
    }
  }

  const panelId = `section-${deploymentId}-${index}`

  return (
    <div
      data-print-avoid-break
      className="panel overflow-hidden rounded-lg border border-line bg-panel transition hover:bg-panel-2"
    >
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between px-6 py-4 transition hover:bg-accent/60"
      >
        <div className="flex items-center gap-4 text-left">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-line font-mono text-xs text-muted-foreground">
            {String(index + 1).padStart(2, '0')}
          </div>
          <div>
            <span className="font-semibold text-foreground">{title}</span>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-line">
            <div
              className="h-full bg-go transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="min-w-fit font-mono text-xs text-muted-foreground">
            {checkedCount}/{items.length}
          </span>
          <ChevronRight
            size={16}
            aria-hidden
            className={`no-print text-muted-foreground transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {/**
       * Rendered whether or not the section is open, and hidden with `hidden`
       * rather than dropped from the tree.
       *
       * This was `{open && …}`. Only section one starts open, so Print produced a
       * sheet with nine bare headers and no items — and no stylesheet could fix it,
       * because CSS cannot reveal what was never rendered. `[data-print-expand]` in
       * the print block had nothing to act on.
       *
       * `hidden` keeps the collapsed content out of the accessibility tree and out
       * of tab order, which is what an accordion should do on screen, while leaving
       * it in the document for print to force open.
       */}
      <div id={panelId} hidden={!open} data-print-expand className="border-t border-line">
        {error && (
          <div className="no-print border-b border-blocked/30 bg-blocked-surface px-6 py-2 text-xs text-blocked">
            {error}
          </div>
        )}

        {items.map((item) => {
          const checked = isChecked(item)

          return (
            <div
              key={item.id}
              data-print-avoid-break
              className="group flex items-start gap-3 border-b border-line px-6 py-3 transition last:border-b-0 hover:bg-accent/40"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(event) => handleToggle(item, event.target.checked)}
                disabled={readOnly || pendingId === item.id || item.skipped}
                aria-label={item.label}
                className="mt-0.5 h-5 w-5 cursor-pointer rounded border border-line bg-panel-2 accent-go checked:border-go checked:bg-go disabled:cursor-not-allowed disabled:opacity-50"
              />

              {/**
               * A tick box prints as an empty square in most browsers regardless of
               * its checked state, so the printed sheet needs a mark of its own —
               * otherwise every item reads as outstanding on paper.
               */}
              <span aria-hidden className="print-only mt-0.5 font-mono text-sm">
                {item.skipped ? '[—]' : checked ? '[x]' : '[ ]'}
              </span>

              <div className="flex-1">
                <label
                  className={`select-none text-sm transition ${
                    checked || item.skipped
                      ? 'text-muted-foreground line-through'
                      : 'text-foreground group-hover:text-foreground'
                  }`}
                >
                  {item.label}
                  {!item.isRequired && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      optional
                    </span>
                  )}
                  {item.skipped && (
                    <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-hold">
                      skipped
                    </span>
                  )}
                </label>

                {item.helpText && <p className="mt-1 text-xs text-muted-foreground">{item.helpText}</p>}

                {/**
                 * Evidence-required items need a note before they can be checked.
                 * The box stays editable while unchecked so the note can be
                 * entered first; once checked, the saved note shows read-only
                 * alongside the sign-off. Without this input such an item could
                 * never be ticked and the run could never pass its gate.
                 */}
                {item.evidenceRequired && !item.skipped && !checked && !readOnly ? (
                  <div className="no-print mt-2">
                    <label
                      htmlFor={`note-${item.id}`}
                      className="font-mono text-[10px] uppercase tracking-wider text-hold"
                    >
                      Evidence required
                    </label>
                    <textarea
                      id={`note-${item.id}`}
                      value={draftFor(item)}
                      onChange={(event) =>
                        setNoteDraft((prev) => ({ ...prev, [item.id]: event.target.value }))
                      }
                      disabled={pendingId === item.id}
                      rows={2}
                      placeholder="Record the evidence — a snapshot id, a ticket link, a confirmation…"
                      className="mt-1 w-full rounded border border-line bg-panel-2 px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-hold/60 focus:outline-none disabled:opacity-50"
                    />
                  </div>
                ) : (
                  item.note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="text-muted-foreground/70">note:</span> {item.note}
                    </p>
                  )
                )}

                {/* Who ticked it and when — the part that makes this a record. */}
                {checked && item.checkedByName && (
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                    {item.checkedByName}
                    {item.checkedAt ? ` · ${new Date(item.checkedAt).toLocaleString()}` : ''}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
