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
  checked: boolean
  skipped?: boolean
  note?: string | null
  checkedByName?: string | null
  checkedAt?: Date | string | null
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

  const isChecked = (item: ChecklistItem) => optimistic[item.id] ?? item.checked

  const checkedCount = items.filter((item) => isChecked(item) || item.skipped).length
  const progressPercent = items.length > 0 ? (checkedCount / items.length) * 100 : 0

  const handleToggle = async (item: ChecklistItem, checked: boolean) => {
    setPendingId(item.id)
    setError(null)
    setOptimistic((prev) => ({ ...prev, [item.id]: checked }))

    try {
      const result = await updateDeploymentItem(deploymentId, item.id, {
        checked,
        skipped: false,
      })

      if (result && typeof result === 'object' && 'ok' in result && !result.ok) {
        // Roll the optimistic value back — the server rejected it. Most likely
        // an evidence-required item, or a run that is no longer editable.
        setOptimistic((prev) => ({ ...prev, [item.id]: !checked }))
        setError((result as { message?: string }).message ?? 'Could not update that item.')
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

  return (
    <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-900/50 transition hover:bg-gray-900/70">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-6 py-4 transition hover:bg-gray-800/50"
      >
        <div className="flex items-center gap-4 text-left">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-gray-600 font-mono text-xs text-gray-400">
            {String(index + 1).padStart(2, '0')}
          </div>
          <div>
            <span className="font-semibold text-white">{title}</span>
            {description && <p className="mt-0.5 text-xs text-gray-500">{description}</p>}
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="h-1 w-16 overflow-hidden rounded-full bg-gray-700">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="min-w-fit font-mono text-xs text-gray-400">
            {checkedCount}/{items.length}
          </span>
          <ChevronRight
            size={16}
            className={`text-gray-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-700">
          {error && (
            <div className="border-b border-red-900/50 bg-red-950/40 px-6 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          {items.map((item) => {
            const checked = isChecked(item)

            return (
              <div
                key={item.id}
                className="group flex items-start gap-3 border-b border-gray-800 px-6 py-3 transition last:border-b-0 hover:bg-gray-800/30"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => handleToggle(item, event.target.checked)}
                  disabled={readOnly || pendingId === item.id || item.skipped}
                  aria-label={item.label}
                  className="mt-0.5 h-5 w-5 cursor-pointer rounded border border-gray-600 bg-gray-800 accent-green-600 checked:border-green-600 checked:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50"
                />

                <div className="flex-1">
                  <label
                    className={`select-none text-sm transition ${
                      checked || item.skipped
                        ? 'text-gray-500 line-through'
                        : 'text-gray-200 group-hover:text-white'
                    }`}
                  >
                    {item.label}
                    {!item.isRequired && (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-gray-600">
                        optional
                      </span>
                    )}
                    {item.skipped && (
                      <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-amber-600">
                        skipped
                      </span>
                    )}
                  </label>

                  {item.helpText && <p className="mt-1 text-xs text-gray-500">{item.helpText}</p>}
                  {item.note && (
                    <p className="mt-1 text-xs text-gray-400">
                      <span className="text-gray-600">note:</span> {item.note}
                    </p>
                  )}

                  {/* Who ticked it and when — the part that makes this a record. */}
                  {checked && item.checkedByName && (
                    <p className="mt-1 font-mono text-[10px] text-gray-600">
                      {item.checkedByName}
                      {item.checkedAt
                        ? ` · ${new Date(item.checkedAt).toLocaleString()}`
                        : ''}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
