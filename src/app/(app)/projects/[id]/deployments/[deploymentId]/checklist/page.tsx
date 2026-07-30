import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { getDeployment } from '@/features/deployments/actions/deployments.actions'
import {
  type ChecklistSnapshot,
  joinSnapshot,
  summarise,
} from '@/features/deployments/checklist-snapshot'
import { DeploymentGauge } from '@/features/deployments/components/deployment-gauge'
import { DeploymentSectionPanel } from '@/features/deployments/components/deployment-section-panel'
import { PrintChecklistButton } from '@/features/deployments/components/print-checklist-button'

export const metadata = { title: 'Deployment Checklist' }

/**
 * The checklist itself, rendered from the run's frozen snapshot.
 *
 * Structure comes from `DeploymentRun.checklist` — the template content copied in
 * at creation — and tick state from `ChecklistItemState`, joined on the snapshot
 * item id. Two sources on purpose: the snapshot is immutable so the checklist
 * cannot change under a run in progress, while the states are what people write.
 *
 * This previously read `deployment.items`, which is not a field on DeploymentRun.
 * Behind an `any` that silently evaluated to undefined, so every run rendered "No
 * checklist items for this deployment" regardless of content, and the gauge sat at
 * 0/0. The data had been correct the whole time.
 */

export default async function DeploymentChecklistPage(props: {
  params: Promise<{ id: string; deploymentId: string }>
}) {
  const params = await props.params

  let deployment
  try {
    deployment = await getDeployment(params.deploymentId)
  } catch {
    notFound()
  }

  if (!deployment) notFound()

  const snapshot = deployment.checklist as unknown as ChecklistSnapshot
  const sections = joinSnapshot(snapshot, deployment.itemStates)
  const {
    total: totalItems,
    accounted: checkedItems,
    requiredOutstanding,
  } = summarise(deployment.itemStates)

  const sealed = deployment.status === 'COMPLETED' || deployment.status === 'CANCELLED'
  const heading = deployment.title || `${deployment.reference} · ${deployment.version}`

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${params.id}/deployments/${params.deploymentId}`}>
            <Button variant="ghost">← Back to Deployment</Button>
          </Link>
        </div>
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-widest text-gray-400">
            {deployment.reference} · {deployment.environmentName} · {deployment.version}
          </p>
          <h1 className="text-4xl font-bold text-white">{heading}</h1>
          <p className="mt-2 text-gray-400">
            {snapshot.templateName ? `${snapshot.templateName} v${snapshot.version} — ` : ''}
            {requiredOutstanding === 0
              ? 'All required items are accounted for.'
              : `${requiredOutstanding} required item${requiredOutstanding === 1 ? '' : 's'} still outstanding.`}
          </p>
        </div>
      </div>

      <DeploymentGauge progress={checkedItems} total={totalItems} />

      <div className="space-y-3">
        {sections.length > 0 ? (
          sections.map((section, idx) => (
            <DeploymentSectionPanel
              key={section.id}
              index={idx}
              title={section.title}
              description={section.description}
              items={section.items}
              deploymentId={params.deploymentId}
              readOnly={sealed}
            />
          ))
        ) : (
          <div className="rounded-lg border border-gray-700 p-8 text-center">
            <p className="text-gray-400">
              This run has no checklist content. The template version it was created from had
              no items for {deployment.environmentName}.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-700 pt-6">
        <p className="text-sm text-gray-400">
          {sealed
            ? `Sealed — this record is ${deployment.status.toLowerCase()} and no longer editable.`
            : `Progress saved automatically · ${checkedItems}/${totalItems} items accounted for`}
        </p>
        <div className="flex gap-2">
          <PrintChecklistButton />
        </div>
      </div>
    </div>
  )
}
