'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Boundary for errors thrown OUTSIDE the authenticated shell — the (auth) pages,
 * and failures inside `(app)/layout.tsx` itself (context resolution, the settings
 * read, the database being unreachable). `(app)/error.tsx` handles everything
 * below the shell with the navigation still standing; by the time an error
 * reaches here there is no shell to stand.
 */
export default function RootErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="eyebrow">// error</p>
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The error has been logged. Try again — and if this page will not load at all, the
        service itself may be having trouble.
      </p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">ref: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
        <Button onClick={() => (window.location.href = '/login')}>Go to sign in</Button>
      </div>
    </div>
  )
}
