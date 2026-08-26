'use client'

interface DeploymentGaugeProps {
  progress: number
  total: number
  /**
   * The readiness verdict from the gate. The ring shows raw completion, but the
   * LAUNCH STATUS must echo the actual gate — deciding GO from `percentage === 100`
   * contradicted the server for any run with optional items (all required ticked,
   * gate GO, ring below 100) and for MANUAL-policy runs (gate always GO). Optional
   * for backwards compatibility; falls back to the old percentage rule.
   */
  gate?: 'GO' | 'HOLD' | 'SEALED'
}

/**
 * Colours come from the theme tokens, not hex constants: the old hardcoded dark
 * gradient (`from-gray-900`) and `#22314a` ring track were tuned for dark mode
 * only, leaving a giant off-palette slab in light mode. CSS variables work in
 * SVG attributes, so the ring can use the same tokens as everything else.
 */
export function DeploymentGauge({ progress, total, gate }: DeploymentGaugeProps) {
  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0
  const circumference = 2 * Math.PI * 42
  const strokeDasharray = `${(circumference * percentage) / 100} ${circumference}`

  const status = gate ?? (percentage === 100 ? 'GO' : 'HOLD')
  const isGo = status === 'GO'
  const ringColor = isGo
    ? 'var(--go)'
    : status === 'SEALED'
      ? 'var(--muted-foreground)'
      : percentage > 60
        ? 'var(--hold)'
        : 'var(--blocked)'

  return (
    <div className="bg-panel border-line flex items-center gap-8 rounded-xl border p-6">
      <div className="relative h-24 w-24">
        <svg viewBox="0 0 100 100" className="h-full w-full" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="var(--line)" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={ringColor}
            strokeWidth="9"
            strokeDasharray={strokeDasharray}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div className="text-foreground absolute inset-0 flex items-center justify-center text-lg font-bold">
          {percentage}%
        </div>
      </div>

      <div>
        <p className="text-muted-foreground mb-2 font-mono text-xs uppercase tracking-widest">
          LAUNCH STATUS
        </p>
        <div
          className={`rounded-lg border px-4 py-2 font-mono text-lg font-bold ${
            isGo
              ? 'bg-go-surface text-go border-go/40'
              : status === 'SEALED'
                ? 'bg-muted text-muted-foreground border-line'
                : 'bg-hold-surface text-hold border-hold/40'
          }`}
        >
          {status}
        </div>
      </div>
    </div>
  )
}
