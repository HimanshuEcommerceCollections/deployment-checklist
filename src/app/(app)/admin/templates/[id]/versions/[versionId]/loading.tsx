import { PageHeaderSkeleton, SectionPanelsSkeleton } from '@/components/skeletons'

/** The template version editor: heading and its section cards. */
export default function TemplateEditorLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <SectionPanelsSkeleton panels={4} />
    </div>
  )
}
