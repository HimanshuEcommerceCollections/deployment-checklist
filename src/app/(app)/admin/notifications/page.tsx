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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Admin - Notifications' }

/**
 * Rows an admin may requeue. Must match RETRYABLE in the retry route — showing a
 * button the route refuses with a 409 is worse than showing none.
 */
const RETRYABLE_STATUSES = ['FAILED', 'DEAD']

export default async function NotificationsPage() {
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.notification.read)

  const notifications = await db.notificationOutbox.findMany({
    where: { organizationId: ctx.organizationId },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Every OutboxStatus is listed. A missing key fell through to grey, which made
  // a dead-lettered row look as unremarkable as a queued one.
  const statusColor: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    SENDING: 'bg-blue-100 text-blue-800',
    SENT: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    DEAD: 'bg-red-200 text-red-900',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Notifications</h1>
        <div className="text-sm text-gray-600">
          <span className="font-medium">{notifications.filter((n) => n.status === 'PENDING').length}</span> pending
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-gray-600">No notifications.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {notifications.map((notif) => (
                <TableRow key={notif.id}>
                  <TableCell className="text-sm font-mono">{notif.templateKey}</TableCell>
                  <TableCell className="text-sm">
                    {notif.toAddresses.join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColor[notif.status] ?? 'bg-gray-100 text-gray-800'}>
                      {notif.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {new Date(notif.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {notif.sentAt ? new Date(notif.sentAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-red-600">
                    {notif.lastError}
                  </TableCell>
                  <TableCell>
                    {RETRYABLE_STATUSES.includes(notif.status) && (
                      <form action={`/api/admin/notifications/${notif.id}/retry`} method="POST">
                        <Button type="submit" size="sm" variant="outline">
                          Retry
                        </Button>
                      </form>
                    )}
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
