import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { requirePermission } from '@/lib/authz/authorize'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const metadata = { title: 'Admin - Audit Log' }

export default async function AuditPage() {
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.audit.read)

  const entries = await db.auditLog.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Audit Log</h1>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">No audit entries yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry: any) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm">{entry.actorName}</TableCell>
                  <TableCell className="font-mono text-sm">{entry.action}</TableCell>
                  <TableCell className="text-sm">
                    {entry.entityType}
                    {entry.entityId && ` (${entry.entityId.slice(0, 8)}...)`}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {entry.summary}
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
