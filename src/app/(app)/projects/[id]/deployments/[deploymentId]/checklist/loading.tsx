import { PageHeaderSkeleton, SectionPanelsSkeleton } from '@/components/skeletons'
import { Skeleton } from '@/components/ui/skeleton'

/** The checklist page: heading, gauge card, then the section panels. */
export default function ChecklistLoading() {
  return (
    <div className="space-y-8">
      <PageHeaderSkeleton />
      <div className="flex items-center gap-8 rounded-xl border p-6">
        <Skeleton className="h-24 w-24 rounded-full" />
        <div className="space-y-3">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-10 w-24 rounded-lg" />
        </div>
      </div>
      <SectionPanelsSkeleton panels={5} />
    </div>
  )
}
