import { PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons'

/** Route-shaped placeholder for the users table. */
export default function UsersLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={8} />
    </div>
  )
}
