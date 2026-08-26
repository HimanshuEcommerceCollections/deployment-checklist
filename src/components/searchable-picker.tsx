'use client'

import { useMemo, useState } from 'react'

import { Input } from '@/components/ui/input'

export interface PickerOption {
  id: string
  /** The headline — a person's name, a project's name. */
  primary: string
  /** Matched alongside primary — an email, a project key. */
  secondary?: string
  /** Context shown but not searched — role names and the like. */
  hint?: string
}

interface Props {
  options: PickerOption[]
  value: string
  onSelect: (id: string) => void
  placeholder?: string
  disabled?: boolean
  inputId?: string
}

/**
 * A search box over a pre-loaded list, for dialogs that pick one thing.
 *
 * This replaced plain dropdowns in the assign dialogs: a select works at ten
 * options and stops working at fifty, and the candidate lists here grow with
 * the organization. Filtering happens client-side over the options the server
 * already sent — matching primary and secondary, case-insensitively — so there
 * is no endpoint and no debounce to get wrong.
 */
export function SearchablePicker({
  options,
  value,
  onSelect,
  placeholder = 'Search…',
  disabled = false,
  inputId,
}: Props) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (option) =>
        option.primary.toLowerCase().includes(q) ||
        (option.secondary?.toLowerCase().includes(q) ?? false),
    )
  }, [options, query])

  return (
    <div className="space-y-2">
      <Input
        id={inputId}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
      />

      <div
        role="listbox"
        aria-label={placeholder}
        className="max-h-56 overflow-y-auto rounded-md border"
      >
        {filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            No matches for &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          filtered.map((option) => {
            const selected = option.id === value
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => onSelect(option.id)}
                className={`flex w-full items-baseline justify-between gap-3 border-b px-3 py-2 text-left text-sm transition last:border-b-0 disabled:opacity-50 ${
                  selected ? 'bg-accent' : 'hover:bg-accent/50'
                }`}
              >
                <span className="min-w-0">
                  <span className="font-medium">{option.primary}</span>
                  {option.secondary && (
                    <span className="ml-2 font-mono text-xs text-muted-foreground">
                      {option.secondary}
                    </span>
                  )}
                </span>
                {option.hint && (
                  <span className="shrink-0 text-xs text-muted-foreground">{option.hint}</span>
                )}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
