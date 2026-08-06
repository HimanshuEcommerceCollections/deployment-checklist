/**
 * Route-level loading state for the authenticated shell. Every page here reads
 * Atlas before rendering; without this, a click on a nav link froze with no
 * feedback for the whole round trip.
 */
export default function AppLoading() {
  return (
    <div
      className="flex min-h-[60vh] items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="flex items-center gap-3 text-muted-foreground">
        <span className="size-4 animate-spin rounded-full border-2 border-line border-t-cyan" />
        <span className="font-mono text-xs uppercase tracking-widest">Loading…</span>
      </div>
    </div>
  )
}
