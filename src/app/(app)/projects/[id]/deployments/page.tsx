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

export default async function DeploymentsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const deployments = await listProjectDeployments(params.id)

  const statusColor = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return 'bg-muted text-foreground'
      case 'IN_PROGRESS':
        return 'bg-cyan/10 text-cyan'
      case 'COMPLETED':
        return 'bg-go-surface text-go'
      case 'FAILED':
        return 'bg-blocked-surface text-blocked'
      default:
        return 'bg-muted text-foreground'
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
          <p className="text-muted-foreground">No deployments yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.map((dep) => (
                <TableRow key={dep.id}>
                  <TableCell className="font-medium">
                    {/* `title` is optional — a run created without one showed a
                        blank name. The reference is always present. */}
                    {dep.title || `${dep.reference} · ${dep.version}`}
                    <span className="block font-mono text-xs text-muted-foreground">{dep.reference}</span>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColor(dep.status)}>{dep.status}</Badge>
                  </TableCell>
                  <TableCell>{dep.environment?.name}</TableCell>
                  {/* Was `_count.items`, which the query never selects — the
                      column rendered blank on every row. The run maintains these
                      two counters atomically, so no include is needed. */}
                  <TableCell className="text-sm">
                    {dep.completedItems}/{dep.totalItems}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
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
