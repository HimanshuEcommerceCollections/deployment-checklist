import { CardSkeleton, PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons'

/** Project overview: header, summary cards, recent deployments. */
export default function ProjectLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
        <CardSkeleton lines={2} />
      </div>
      <TableSkeleton rows={5} />
    </div>
  )
}
