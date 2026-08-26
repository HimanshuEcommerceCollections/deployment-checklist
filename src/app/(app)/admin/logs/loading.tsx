import { PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons'

/** Route-shaped placeholder for the logs table. */
export default function LogsLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={10} />
    </div>
  )
}
