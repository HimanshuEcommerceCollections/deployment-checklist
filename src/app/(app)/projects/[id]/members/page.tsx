import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { listProjectMembers } from '@/features/projects/actions/members.actions'

export const metadata = { title: 'Project Access' }

/**
 * Project access is org-wide.
 *
 * Access is decided by the actor's role, evaluated by `can()` — not by a
 * Membership row. This page previously offered "Add Member" and "Edit" buttons
 * pointing at routes that were never written, so both 404'd.
 *
 * Rather than build a member editor for a mechanism that is switched off, this
 * explains where access actually comes from and links there. The project-scoped
 * grant path still exists in the authz layer and the schema, dormant: if a
 * Membership is created, `projectFilter` narrows to it automatically. So any rows
 * that do exist are still listed. See docs/14 §14.2 and §14.5.
 */
export default async function ProjectAccessPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const members = await listProjectMembers(params.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/projects/${params.id}`}>
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Project Access</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Access is organisation-wide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-600">
          <p>
            Everyone in this organisation can see and act on this project according to
            their role. There is no per-project membership to manage.
          </p>
          <p>
            To change what someone can do here — view, run a deployment, tick items,
            ship to production — change their role.
          </p>
          <Link href="/admin/users">
            <Button variant="outline" size="sm">
              Manage users and roles
            </Button>
          </Link>
        </CardContent>
      </Card>

      {members.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-600">
            Additional project-scoped grants
          </h2>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles on this project</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => (
                  <TableRow key={member.user.id}>
                    <TableCell className="font-medium">{member.user.name}</TableCell>
                    <TableCell>{member.user.email}</TableCell>
                    <TableCell className="text-sm text-gray-600">
                      {member.roles.map((role) => role.name).join(', ') || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  )
}
