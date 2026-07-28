import type { ReactNode } from 'react'

import { ThemeToggle } from '@/components/layout/theme-toggle'

/**
 * Unauthenticated shell.
 *
 * Deliberately shows the same "launch console" identity as the app itself —
 * the eyebrow treatment and the dark panel — so signing in does not feel like a
 * different product.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="eyebrow mb-2">// Release Control</p>
          <h1 className="text-2xl font-semibold tracking-tight">Deployment Checklist</h1>
        </div>

        {children}

        <p className="text-muted-foreground mt-8 text-center text-xs">
          Access is by invitation only.
        </p>
      </div>
    </div>
  )
}
