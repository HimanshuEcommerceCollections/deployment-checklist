'use client'

/**
 * Full-page loader for the gap between a successful action and the next route
 * rendering — login → dashboard, create deployment → checklist. In that window
 * the old page is still mounted but its pending flags have already cleared, so
 * without this the screen just sits there looking done while nothing responds.
 *
 * Render it near the end of the form and flip `show` on right before
 * `router.push`; it disappears with the component when the new route mounts.
 */
export function RouteTransitionOverlay({ show, label = 'Loading…' }: { show: boolean; label?: string }) {
  if (!show) return null

  return (
    <div
      role="status"
      aria-label={label}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-4">
        <span className="size-10 animate-spin rounded-full border-4 border-line border-t-cyan" />
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  )
}
