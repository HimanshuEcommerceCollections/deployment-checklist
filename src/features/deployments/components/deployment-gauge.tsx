'use client'

interface DeploymentGaugeProps {
  progress: number
  total: number
}

export function DeploymentGauge({ progress, total }: DeploymentGaugeProps) {
  const percentage = total > 0 ? Math.round((progress / total) * 100) : 0
  const circumference = 2 * Math.PI * 42
  const strokeDasharray = `${(circumference * percentage) / 100} ${circumference}`

  const isGo = percentage === 100
  const color = isGo ? '#35d68f' : percentage > 60 ? '#f0b54c' : '#ef5f6b'
  const status = isGo ? 'GO' : 'HOLD'
  const statusClass = isGo ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'

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
            : 'bg-yellow-900 text-yellow-300 border-yellow-700'
        }`}>
          {status}
        </div>
      </div>
    </div>
  )
}
