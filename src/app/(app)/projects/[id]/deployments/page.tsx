import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { listProjectDeployments } from '@/features/deployments/actions/deployments.actions'
import {
  type DeploymentRow,
  ProjectDeploymentsExplorer,
} from '@/features/deployments/components/project-deployments-explorer'

export const metadata = { title: 'Deployments' }

export default async function DeploymentsPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [params, searchParams] = await Promise.all([props.params, props.searchParams])

  // Repeated params (?q=a&q=b) arrive as arrays — take the first, the schema
  // handles the rest of the sanitising.
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value

  const query = {
    q: first(searchParams.q),
    scope: first(searchParams.scope),
    from: first(searchParams.from),
    to: first(searchParams.to),
    page: first(searchParams.page),
    pageSize: first(searchParams.pageSize),
  }

  const { rows, total, page, pageSize } = await listProjectDeployments(params.id, query)

  const tableRows: DeploymentRow[] = rows.map((dep) => ({
    id: dep.id,
    reference: dep.reference,
    title: dep.title,
    version: dep.version,
    status: dep.status,
    environmentName: dep.environment?.name ?? dep.environmentName,
    completedItems: dep.completedItems,
    totalItems: dep.totalItems,
    createdAt: dep.createdAt.toISOString(),
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${params.id}`}>
            <Button variant="ghost">← Back</Button>
          </Link>
          <h1 className="text-3xl font-bold">Deployments</h1>
        </div>
        <Link href={`/projects/${params.id}/deployments/new`}>
          <Button>Create Deployment</Button>
        </Link>
      </div>

      <ProjectDeploymentsExplorer
        projectId={params.id}
        rows={tableRows}
        total={total}
        page={page}
        pageSize={pageSize}
        query={{
          q: query.q,
          scope: query.scope,
          from: query.from,
          to: query.to,
        }}
      />
    </div>
  )
}
