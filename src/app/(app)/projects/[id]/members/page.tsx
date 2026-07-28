import { listProjectMembers } from '@/features/projects/actions/members.actions'
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

export const metadata = { title: 'Project Members' }

export default async function ProjectMembersPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const members = await listProjectMembers(params.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${params.id}`}>
            <Button variant="ghost">← Back</Button>
          </Link>
          <h1 className="text-3xl font-bold">Project Members</h1>
        </div>
        <Link href={`/projects/${params.id}/members/invite`}>
          <Button>Add Member</Button>
        </Link>
      </div>

      {members.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-gray-600">No members yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Added</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member: any) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">{member.user?.name}</TableCell>
                  <TableCell>{member.user?.email}</TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {member.roles?.map((r: any) => r.name).join(', ') || 'No roles'}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {new Date(member.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <Link href={`/projects/${params.id}/members/${member.id}`}>
                      <Button variant="ghost" size="sm">Edit</Button>
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
