import { CardSkeleton, PageHeaderSkeleton, StatTilesSkeleton } from '@/components/skeletons'

/** Usage & Analytics: stat tiles and the trend chart. */
export default function UsageLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatTilesSkeleton count={4} />
      <CardSkeleton lines={8} />
    </div>
  )
}
