import { Skeleton } from '@/components/ui/skeleton'

/**
 * Page-shaped loading placeholders, composed per route in `loading.tsx` files.
 *
 * Every route previously fell back to the one generic spinner in
 * `(app)/loading.tsx`; these give the heavy pages a silhouette of what is
 * coming so navigation reads as progress rather than a blank wait. Keep the
 * shapes approximate — a skeleton that mimics the page too precisely breaks
 * every time the page changes.
 */

export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
    </div>
  )
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="border-b bg-muted/60 px-4 py-3">
        <Skeleton className="h-4 w-1/2" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function StatTilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-5">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-3 rounded-lg border p-5">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full" />
      ))}
    </div>
  )
}

/** Collapsed checklist sections, for the deployment/checklist routes. */
export function SectionPanelsSkeleton({ panels = 4 }: { panels?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: panels }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg border px-6 py-4">
          <Skeleton className="h-8 w-8 rounded" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-1.5 w-16 rounded-full" />
          <Skeleton className="h-4 w-10" />
        </div>
      ))}
    </div>
  )
}
