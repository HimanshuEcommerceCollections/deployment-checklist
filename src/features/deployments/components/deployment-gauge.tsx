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

export function DeploymentGauge({ progress, total, gate }: DeploymentGaugeProps) {
  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0
  const circumference = 2 * Math.PI * 42
  const strokeDasharray = `${(circumference * percentage) / 100} ${circumference}`

  const status = gate ?? (percentage === 100 ? 'GO' : 'HOLD')
  const isGo = status === 'GO'
  const color = isGo ? '#35d68f' : status === 'SEALED' ? '#8b98ab' : percentage > 60 ? '#f0b54c' : '#ef5f6b'

  return (
    <div className="flex items-center gap-8 bg-gradient-to-br from-gray-900 to-gray-800 rounded-xl p-6 border border-gray-700">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="#22314a" strokeWidth="9" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={color}
            strokeWidth="9"
            strokeDasharray={strokeDasharray}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.5s ease, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-white font-bold text-lg">
          {percentage}%
        </div>
      </div>

      <div>
        <p className="text-xs font-mono text-gray-400 uppercase tracking-widest mb-2">LAUNCH STATUS</p>
        <div className={`px-4 py-2 rounded-lg font-mono font-bold text-lg border ${
          isGo
            ? 'bg-green-900 text-green-300 border-green-700'
            : status === 'SEALED'
              ? 'bg-gray-800 text-gray-300 border-gray-600'
              : 'bg-yellow-900 text-yellow-300 border-yellow-700'
        }`}>
          {status}
        </div>
      </div>
    </div>
  )
}
