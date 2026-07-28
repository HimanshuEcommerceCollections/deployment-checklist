import { getDeployment } from '@/features/deployments/actions/deployments.actions'
import { DeploymentGauge } from '@/features/deployments/components/deployment-gauge'
import { DeploymentSectionPanel } from '@/features/deployments/components/deployment-section-panel'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { notFound } from 'next/navigation'

export const metadata = { title: 'Deployment Checklist' }

export default async function DeploymentChecklistPage(props: {
  params: Promise<{ id: string; deploymentId: string }>
}) {
  const params = await props.params
  let deployment: any

  try {
    deployment = await getDeployment(params.deploymentId)
  } catch {
    notFound()
  }

  if (!deployment) notFound()

  // Group items by sections (if they exist)
  const sections = deployment.items
    ? [
        {
          id: '1',
          title: 'Deployment Items',
          items: deployment.items.map((item: any) => ({
            id: item.id,
            title: item.title,
            checked: item.checked,
          })),
        },
      ]
    : []

  const totalItems = deployment.items?.length || 0
  const checkedItems = deployment.items?.filter((i: any) => i.checked).length || 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${params.id}/deployments/${params.deploymentId}`}>
            <Button variant="ghost">← Back to Deployment</Button>
          </Link>
        </div>
        <div>
          <p className="text-xs font-mono text-gray-400 uppercase tracking-widest mb-2">Release Control</p>
          <h1 className="text-4xl font-bold text-white">{deployment.title}</h1>
          <p className="text-gray-400 mt-2">Work through every item before marking deployment complete</p>
        </div>
      </div>

      {/* Gauge */}
      <DeploymentGauge progress={checkedItems} total={totalItems} />

      {/* Sections */}
      <div className="space-y-3">
        {sections.length > 0 ? (
          sections.map((section, idx) => (
            <DeploymentSectionPanel
              key={section.id}
              index={idx}
              title={section.title}
              items={section.items}
              deploymentId={params.deploymentId}
            />
          ))
        ) : (
          <div className="rounded-lg border border-gray-700 p-8 text-center">
            <p className="text-gray-400">No checklist items for this deployment</p>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-gray-700 pt-6 flex items-center justify-between">
        <p className="text-sm text-gray-400">
          Progress saved automatically {checkedItems}/{totalItems} items checked
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>
            Print / Save PDF
          </Button>
          {checkedItems === totalItems && (
            <Button className="bg-green-600 hover:bg-green-700">
              ✓ Ready to Deploy
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
