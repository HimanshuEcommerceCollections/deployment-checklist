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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Deployments' }

export default async function DeploymentsPage() {
  const deployments = await listAllUserDeployments()

  const statusColor = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-gray-100 text-gray-800'
      case 'IN_PROGRESS':
        return 'bg-blue-100 text-blue-800'
      case 'COMPLETED':
        return 'bg-green-100 text-green-800'
      case 'FAILED':
        return 'bg-red-100 text-red-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

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
          <p className="text-gray-600">No deployments yet. Start a deployment from a project.</p>
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
              {deployments.map((dep: any) => {
                const checkedCount = 0 // Would need items included to calculate
                const totalCount = dep._count.items
                const progress = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0

                return (
                  <TableRow key={dep.id}>
                    <TableCell className="font-medium">{dep.project?.name}</TableCell>
                    <TableCell>{dep.title}</TableCell>
                    <TableCell>
                      <Badge className={statusColor(dep.status)}>{dep.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{dep.environment?.name}</TableCell>
                    <TableCell className="text-sm">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-gray-200">
                          <div
                            className="h-2 rounded-full bg-green-500"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600">{progress}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-gray-600">
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
