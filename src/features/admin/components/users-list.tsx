'use client'

import { Badge } from '@/components/ui/badge'
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
}

interface UsersListProps {
  users: User[]
}

const statusColors: Record<UserStatus, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  INVITED: 'bg-blue-100 text-blue-800',
  SUSPENDED: 'bg-yellow-100 text-yellow-800',
  DEACTIVATED: 'bg-gray-100 text-gray-800',
}

export function UsersList({ users }: UsersListProps) {
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-gray-600">No users yet. Invite someone to get started.</p>
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
            <TableHead>Status</TableHead>
            <TableHead>Joined</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge className={statusColors[user.status]}>
                  {user.status}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-gray-600">
                {new Date(user.createdAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
