import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { type DeploymentStatus, evaluateGate, isEditable } from '@/domain/deployments/lifecycle'
import {
  type ChecklistSnapshot,
  joinSnapshot,
  summarise,
} from '@/features/deployments/checklist-snapshot'
import { DeploymentGauge } from '@/features/deployments/components/deployment-gauge'
import { DeploymentSectionPanel } from '@/features/deployments/components/deployment-section-panel'
import { DeploymentStatusActions } from '@/features/deployments/components/deployment-status-actions'
import { DeploymentStatusBadge } from '@/features/deployments/components/deployment-status-badge'
import { PrintChecklistButton } from '@/features/deployments/components/print-checklist-button'
import { deploymentsService } from '@/features/deployments/server/deployments-service'
import { getRequestContext } from '@/server/context'

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
  const ctx = await getRequestContext()

  let deployment
  try {
    deployment = await deploymentsService.getDeployment(ctx, params.deploymentId)
  } catch {
    notFound()
  }

  if (!deployment) notFound()

  const snapshot = deployment.checklist as unknown as ChecklistSnapshot
  const sections = joinSnapshot(snapshot, deployment.itemStates)
  const { total: totalItems, accounted: checkedItems } = summarise(deployment.itemStates)

  /**
   * Read-only comes from the state machine, not a hand-written status list. This
   * was `status === 'COMPLETED' || status === 'CANCELLED'`, which missed FAILED
   * and ROLLED_BACK — harmless while nothing could reach them, and a UI that
   * offers ticks the server refuses now that everything can.
   */
  const sealed = !isEditable(deployment.status as DeploymentStatus)

  /// The gate, not the gauge. Under ALL_REQUIRED a run reads GO with optional
  /// items unticked, which is what marking them optional is for.
  const gate = evaluateGate(snapshot.completionPolicy, deployment)
  const transitions = deploymentsService.availableTransitions(ctx, deployment)

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
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-4xl font-bold text-white">{heading}</h1>
            <DeploymentStatusBadge status={deployment.status} />
          </div>
          <p className="mt-2 text-gray-400">
            {snapshot.templateName ? `${snapshot.templateName} v${snapshot.version} — ` : ''}
            {gate.passes
              ? gate.policy === 'MANUAL'
                ? 'No checklist gate on this template — completion is by permission alone.'
                : 'Every gating item is accounted for.'
              : gate.message}
          </p>
        </div>
      </div>

      <DeploymentGauge progress={checkedItems} total={totalItems} />

      {transitions.length > 0 && (
        <div className="rounded-xl border border-gray-700 bg-gray-900/50 p-6">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-gray-400">
            Launch control
          </p>
          <DeploymentStatusActions
            deploymentId={deployment.id}
            reference={deployment.reference}
            options={transitions}
          />
        </div>
      )}

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
