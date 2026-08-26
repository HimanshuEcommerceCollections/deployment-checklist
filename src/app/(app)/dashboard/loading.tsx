import { PageHeaderSkeleton, StatTilesSkeleton, TableSkeleton } from '@/components/skeletons'

/** Route-shaped placeholder for the dashboard. */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatTilesSkeleton count={4} />
      <TableSkeleton rows={6} />
    </div>
  )
}
