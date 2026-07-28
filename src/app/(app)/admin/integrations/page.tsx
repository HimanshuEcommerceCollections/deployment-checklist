import { listIntegrations } from '@/features/admin/actions/integrations.actions'
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

export const metadata = { title: 'Integrations' }

export default async function IntegrationsPage() {
  const integrations = await listIntegrations()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Integrations</h1>
        <Link href="/admin/integrations/new">
          <Button>Add Integration</Button>
        </Link>
      </div>

      {integrations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-gray-600">No integrations yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {integrations.map((integration: any) => (
                <TableRow key={integration.id}>
                  <TableCell className="font-medium">{integration.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {integration.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={
                        integration.enabled
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }
                    >
                      {integration.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {new Date(integration.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Link href={`/admin/integrations/${integration.id}`}>
                      <Button variant="ghost" size="sm">
                        Edit
                      </Button>
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
