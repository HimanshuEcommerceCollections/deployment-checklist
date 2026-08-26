import { PageHeaderSkeleton, TableSkeleton } from '@/components/skeletons'

/** Route-shaped placeholder for the templates list. */
export default function TemplatesLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <TableSkeleton rows={5} />
    </div>
  )
}
