import { listProjectDeployments } from '@/features/deployments/actions/deployments.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export default async function DeploymentsPage({ params }: { params: { id: string } }) {
  const deployments = await listProjectDeployments(params.id)

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
        <h1 className="text-3xl font-bold">Deployments</h1>
        <Link href={`/projects/${params.id}/deployments/new`}>
          <Button>Create Deployment</Button>
        </Link>
      </div>

      {deployments.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-gray-600">No deployments yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.map((dep: any) => (
                <TableRow key={dep.id}>
                  <TableCell className="font-medium">{dep.title}</TableCell>
                  <TableCell>
                    <Badge className={statusColor(dep.status)}>{dep.status}</Badge>
                  </TableCell>
                  <TableCell>{dep.environment?.name}</TableCell>
                  <TableCell>{dep._count.items}</TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {new Date(dep.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Link href={`/projects/${params.id}/deployments/${dep.id}`}>
                      <Button variant="ghost" size="sm">View</Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
