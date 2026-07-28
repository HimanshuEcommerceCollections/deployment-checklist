import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'Application Logs' }

export default async function LogsPage() {
  const ctx = await getRequestContext()

  const logs = await db.auditLog.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const levelColor: Record<string, string> = {
    error: 'bg-red-100 text-red-800',
    warning: 'bg-yellow-100 text-yellow-800',
    info: 'bg-blue-100 text-blue-800',
    debug: 'bg-gray-100 text-gray-800',
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Application Logs</h1>
        <p className="text-gray-600 mt-2">View system and application events</p>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Timestamp</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="text-sm text-gray-600">
                  {new Date(log.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-sm">{log.action}</TableCell>
                <TableCell className="text-sm">
                  {log.entityType} {log.entityLabel && `(${log.entityLabel})`}
                </TableCell>
                <TableCell className="text-sm">{log.actorName}</TableCell>
                <TableCell>
                  <Badge
                    className={
                      log.action.includes('deleted')
                        ? 'bg-red-100 text-red-800'
                        : 'bg-blue-100 text-blue-800'
                    }
                  >
                    {log.action.split('.')[1]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
