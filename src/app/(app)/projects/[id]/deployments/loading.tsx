import { PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons'

/** Route-shaped placeholder for a project's deployments table. */
export default function ProjectDeploymentsLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} />
    </div>
  )
}
