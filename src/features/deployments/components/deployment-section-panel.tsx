'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { updateDeploymentItem } from '../actions/deployments.actions'

interface Item {
  id: string
  title: string
  checked?: boolean
}

interface DeploymentSectionPanelProps {
  index: number
  title: string
  items: Item[]
  deploymentId: string
  onToggle?: (itemId: string, checked: boolean) => void
}

export function DeploymentSectionPanel({
  index,
  title,
  items,
  deploymentId,
  onToggle,
}: DeploymentSectionPanelProps) {
  const [open, setOpen] = useState(index === 0)
  const [isUpdating, setIsUpdating] = useState<Record<string, boolean>>({})

  const checkedCount = items.filter((item) => item.checked).length
  const progressPercent = items.length > 0 ? (checkedCount / items.length) * 100 : 0

  const handleToggle = async (itemId: string, checked: boolean) => {
    setIsUpdating((prev) => ({ ...prev, [itemId]: true }))
    try {
      await updateDeploymentItem(deploymentId, itemId, {
        checked,
        skipped: false,
      })
      onToggle?.(itemId, checked)
    } catch (error) {
      console.error('Failed to update item:', error)
    } finally {
      setIsUpdating((prev) => ({ ...prev, [itemId]: false }))
    }
  }

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden bg-gray-900/50 hover:bg-gray-900/70 transition">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-800/50 transition"
      >
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0 w-8 h-8 rounded border border-gray-600 flex items-center justify-center text-xs font-mono text-gray-400">
            {String(index + 1).padStart(2, '0')}
          </div>
          <span className="font-semibold text-white">{title}</span>
        </div>

        <div className="flex items-center gap-6">
          <div className="w-16 h-1 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-xs font-mono text-gray-400 min-w-fit">
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
          {items.map((item) => (
            <div
              key={item.id}
              className="px-6 py-3 border-b border-gray-800 last:border-b-0 flex items-start gap-3 group hover:bg-gray-800/30 transition"
            >
              <input
                type="checkbox"
                checked={item.checked || false}
                onChange={(e) => handleToggle(item.id, e.target.checked)}
                disabled={isUpdating[item.id]}
                className="mt-0.5 w-5 h-5 rounded border border-gray-600 bg-gray-800 checked:bg-green-600 checked:border-green-600 cursor-pointer accent-green-600 disabled:opacity-50"
              />
              <label
                className={`flex-1 text-sm cursor-pointer select-none transition ${
                  item.checked
                    ? 'text-gray-500 line-through'
                    : 'text-gray-200 group-hover:text-white'
                }`}
              >
                {item.title}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
