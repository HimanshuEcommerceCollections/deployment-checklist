import { CardSkeleton, PageHeaderSkeleton } from '@/components/skeletons'

/** Manage-user page: identity, roles, the permission matrix, project access. */
export default function UserDetailLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <CardSkeleton lines={3} />
          <CardSkeleton lines={6} />
        </div>
        <div className="space-y-6">
          <CardSkeleton lines={5} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </div>
  )
}
