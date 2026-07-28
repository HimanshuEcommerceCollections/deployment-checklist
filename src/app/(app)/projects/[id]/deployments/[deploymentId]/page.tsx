import { getDeployment } from '@/features/deployments/actions/deployments.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { notFound } from 'next/navigation'
import { DeploymentChecklistItems } from '@/features/deployments/components/deployment-checklist-items'
import { DeploymentComments } from '@/features/deployments/components/deployment-comments'

export default async function DeploymentPage(props: {
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

  const checkedCount = deployment.items?.filter((i: any) => i.checked)?.length || 0
  const totalCount = deployment.items?.length || 0
  const progress = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/projects/${params.id}/deployments`}>
            <Button variant="ghost" className="mb-2">← Back</Button>
          </Link>
          <h1 className="text-3xl font-bold">{deployment.title}</h1>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Status</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold capitalize">{deployment.status}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Environment</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{deployment.environment?.name}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold">{progress}%</span>
                <span className="text-sm text-gray-600">{checkedCount}/{totalCount}</span>
              </div>
              <div className="h-2 w-full rounded-full bg-gray-200">
                <div
                  className="h-2 rounded-full bg-green-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
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

      <DeploymentChecklistItems deploymentId={params.deploymentId} items={deployment.items || []} />

      <DeploymentComments
        deploymentId={params.deploymentId}
        comments={deployment.comments || []}
      />
    </div>
  )
}
