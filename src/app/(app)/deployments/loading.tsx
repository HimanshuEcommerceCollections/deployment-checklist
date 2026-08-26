import { PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons'

/** Route-shaped placeholder for the cross-project deployments table. */
export default function DeploymentsLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={10} />
    </div>
  )
}
