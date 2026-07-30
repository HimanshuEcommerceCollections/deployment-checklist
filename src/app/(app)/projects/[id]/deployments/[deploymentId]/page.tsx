import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getDeployment } from '@/features/deployments/actions/deployments.actions'
import {
  type ChecklistSnapshot,
  joinSnapshot,
  summarise,
} from '@/features/deployments/checklist-snapshot'
import { DeploymentComments } from '@/features/deployments/components/deployment-comments'

export const metadata = { title: 'Deployment' }

/**
 * Record overview for one run.
 *
 * Deliberately NOT a second tickable checklist. This page and
 * `./checklist` both used to render a flat list of items from
 * `deployment.items` — a field that does not exist on DeploymentRun, so both
 * showed "No items in this deployment" and 0/0 progress on a run holding 41
 * items. Two independent, broken implementations of the same thing.
 *
 * The split now: this is the header and the audit context — status, environment,
 * progress, release notes, per-section standing, comments. Ticking happens in one
 * place, `./checklist`, which owns the gauge, the collapsible panels and the
 * optimistic writes. One tickable surface means one place for that logic to be
 * correct.
 */
export default async function DeploymentPage(props: {
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
  const { total, accounted, requiredOutstanding, percent } = summarise(deployment.itemStates)

  const heading = deployment.title || `${deployment.reference} · ${deployment.version}`
  const checklistHref = `/projects/${params.id}/deployments/${params.deploymentId}/checklist`

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href={`/projects/${params.id}/deployments`}>
            <Button variant="ghost" className="mb-2">
              ← Back
            </Button>
          </Link>
          <p className="font-mono text-xs uppercase tracking-widest text-gray-500">
            {deployment.reference} · {deployment.version}
            {snapshot.templateName ? ` · ${snapshot.templateName} v${snapshot.version}` : ''}
          </p>
          <h1 className="text-3xl font-bold">{heading}</h1>
        </div>
        <Link href={checklistHref}>
          <Button>Open checklist</Button>
        </Link>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{deployment.status}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{deployment.environmentName}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{percent}%</span>
                <span className="text-sm text-gray-600">
                  {accounted}/{total}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="text-xs text-gray-500">
                {requiredOutstanding === 0
                  ? 'All required items accounted for'
                  : `${requiredOutstanding} required outstanding`}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {deployment.releaseNotes && (
        <Card>
          <CardHeader>
            <CardTitle>Release Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-gray-700">{deployment.releaseNotes}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Checklist</CardTitle>
        </CardHeader>
        <CardContent>
          {sections.length === 0 ? (
            <p className="text-gray-600">
              This run has no checklist content. The template version it was created from had
              no items for {deployment.environmentName}.
            </p>
          ) : (
            <div className="space-y-3">
              {sections.map((section, index) => {
                const sectionPercent =
                  section.items.length > 0
                    ? Math.round((section.accounted / section.items.length) * 100)
                    : 0

                return (
                  <Link
                    key={section.id}
                    href={checklistHref}
                    className="flex items-center gap-4 rounded-lg border p-3 transition hover:bg-gray-50"
                  >
                    <span className="w-6 font-mono text-xs text-gray-400">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="flex-1 text-sm font-medium">{section.title}</span>
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-green-500 transition-all"
                        style={{ width: `${sectionPercent}%` }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-xs text-gray-500">
                      {section.accounted}/{section.items.length}
                    </span>
                  </Link>
                )
              })}
              <p className="pt-1 text-xs text-gray-500">
                Open the checklist to tick items — that is where progress is recorded.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <DeploymentComments
        deploymentId={params.deploymentId}
        comments={deployment.comments || []}
      />
    </div>
  )
}
