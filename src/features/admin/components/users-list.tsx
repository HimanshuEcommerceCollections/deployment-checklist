import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { UserStatus } from '@prisma/client'

interface User {
  id: string
  email: string
  name: string
  status: UserStatus
  createdAt: Date
  roleIds: string[]
}

interface UsersListProps {
  users: User[]
  /** id → display name, so the table shows roles rather than ObjectIds. */
  roleNames: Record<string, string>
}

const statusColors: Record<UserStatus, string> = {
  ACTIVE: 'bg-go-surface text-go',
  INVITED: 'bg-cyan/10 text-cyan',
  SUSPENDED: 'bg-hold-surface text-hold',
  DEACTIVATED: 'bg-muted text-foreground',
}

/**
 * No longer a client component: every row links to the detail page, which owns the
 * writes, so there is no client state left here.
 */
export function UsersList({ users, roleNames }: UsersListProps) {
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">No users yet. Invite someone to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Roles</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const roles = user.roleIds.map((id) => roleNames[id]).filter(Boolean)

            return (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.name}</TableCell>
                <TableCell className="font-mono text-sm">{user.email}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {roles.length > 0 ? roles.join(', ') : '—'}
                </TableCell>
                <TableCell>
                  <Badge className={statusColors[user.status]}>{user.status}</Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(user.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/admin/users/${user.id}`}>
                    <Button variant="ghost" size="sm">
                      {user.status === 'INVITED' ? 'Manage invite' : 'Manage'}
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
