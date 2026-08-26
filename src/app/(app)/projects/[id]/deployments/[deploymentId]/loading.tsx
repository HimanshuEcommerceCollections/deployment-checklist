import { CardSkeleton, PageHeaderSkeleton, SectionPanelsSkeleton } from '@/components/skeletons'

/** Deployment detail: heading, status cards, then the checklist summary. */
export default function DeploymentDetailLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <CardSkeleton lines={1} />
        <CardSkeleton lines={1} />
        <CardSkeleton lines={2} />
      </div>
      <SectionPanelsSkeleton panels={5} />
    </div>
  )
}
