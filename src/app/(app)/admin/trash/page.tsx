import { db } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/authz/authorize'
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
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Admin - Trash' }

export default async function TrashPage() {
  const ctx = await requireAuth()
  requirePermission(ctx, PERMISSIONS.admin.access)

  const [deletedProjects, deletedUsers, deletedTemplates] = await Promise.all([
    db.project.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: { not: null } },
      take: 10,
    }),
    db.user.findMany({
      where: { deletedAt: { not: null } },
      take: 10,
    }),
    db.template.findMany({
      where: { organizationId: ctx.organizationId, deletedAt: { not: null } },
      take: 10,
    }),
  ])

  const totalDeleted = deletedProjects.length + deletedUsers.length + deletedTemplates.length

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Trash</h1>

      {totalDeleted === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-gray-600">Trash is empty.</p>
        </div>
      ) : (
        <>
          {deletedProjects.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">Deleted Projects ({deletedProjects.length})</h2>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Deleted</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deletedProjects.map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.name}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {new Date(p.deletedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" disabled>Restore</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {deletedUsers.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">Deleted Users ({deletedUsers.length})</h2>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Deleted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deletedUsers.map((u: any) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.name}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {new Date(u.deletedAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {deletedTemplates.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-xl font-semibold">Deleted Templates ({deletedTemplates.length})</h2>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Deleted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deletedTemplates.map((t: any) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.name}</TableCell>
                        <TableCell className="text-sm text-gray-600">
                          {new Date(t.deletedAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
