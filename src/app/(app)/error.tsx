'use client'

import { useEffect } from 'react'

import { Button } from '@/components/ui/button'

/**
 * Error boundary for everything inside the authenticated shell.
 *
 * Until this existed, any uncaught server error — including a plain permission
 * denial from `requirePermission` — rendered Next's default "Application error: a
 * server-side exception has occurred" screen. A QA user typing /admin/settings saw
 * what looked like an outage.
 *
 * Sitting inside `(app)/layout.tsx` means the navigation and header stay up, so the
 * user still has somewhere to go. Failures in the layout itself (database down,
 * context resolution) fall through to `src/app/error.tsx`, which assumes no shell.
 *
 * The digest sniffing below is a HINT, not a contract: AppError encodes its code as
 * `APP_ERROR;<CODE>` and Next forwards pre-set digests to production boundaries.
 * If that ever stops, every error degrades to the generic copy — nothing breaks.
 */
export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // The server already logged it with full detail; this is for the browser
    // console during development, where the message is not stripped.
    console.error(error)
  }, [error])

  const code = error.digest?.startsWith('APP_ERROR;') ? error.digest.split(';')[1] : null
  const forbidden = code === 'FORBIDDEN'

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <p className="eyebrow">{forbidden ? '// access' : '// error'}</p>

      <h1 className="text-2xl font-bold">
        {forbidden ? 'You don’t have access to this page' : 'Something went wrong'}
      </h1>

      <p className="text-sm text-muted-foreground">
        {forbidden
          ? 'Your roles don’t include the permission this page needs. If you think they should, ask an administrator — access changes take effect on your next page load, with no need to sign back in.'
          : 'The error has been logged. If it keeps happening, tell an administrator what you were doing when it broke.'}
      </p>

      {error.digest && !forbidden && (
        <p className="font-mono text-xs text-muted-foreground">ref: {error.digest}</p>
      )}

      <div className="flex gap-2">
        {/* Retrying a permission denial re-runs the same check — offer the way out instead. */}
        {!forbidden && (
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        )}
        <Button onClick={() => (window.location.href = '/dashboard')}>Go to dashboard</Button>
      </div>
    </div>
  )
}
