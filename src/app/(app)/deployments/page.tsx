import { listAllUserDeployments } from '@/features/deployments/actions/all-deployments.actions'
import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { DeploymentStatusBadge } from '@/features/deployments/components/deployment-status-badge'

export const metadata = { title: 'Deployments' }

export default async function DeploymentsPage() {
  const deployments = await listAllUserDeployments()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">All Deployments</h1>
        <Link href="/projects">
          <Button>View Projects</Button>
        </Link>
      </div>

      {deployments.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No deployments yet. Start a deployment from a project.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Progress</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.map((dep) => {
                /**
                 * Progress used to be hardcoded to 0 with a note saying it "would
                 * need itemStates included to calculate" — so every row showed an
                 * empty bar at 0%. It does not: DeploymentRun maintains
                 * completedItems and totalItems atomically alongside every item
                 * write, which is exactly why those counters exist.
                 */
                const checkedCount = dep.completedItems
                const totalCount = dep.totalItems
                const progress = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

                return (
                  <TableRow key={dep.id}>
                    <TableCell className="font-medium">{dep.project?.name}</TableCell>
                    <TableCell>
                      {dep.title || `${dep.reference} · ${dep.version}`}
                      <span className="block text-muted-foreground font-mono text-xs">
                        {dep.reference}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DeploymentStatusBadge status={dep.status} />
                    </TableCell>
                    <TableCell className="text-sm">{dep.environment?.name}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 bg-line rounded-full">
                          <div
                            className="h-2 bg-go rounded-full"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-muted-foreground tabular text-xs">
                          {progress}% ({checkedCount}/{totalCount})
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(dep.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Link href={`/projects/${dep.projectId}/deployments/${dep.id}`}>
                        <Button variant="ghost" size="sm">
                          View
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
