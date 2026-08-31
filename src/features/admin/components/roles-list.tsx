'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Role } from '@prisma/client'

interface RolesListProps {
  roles: Role[]
}

export function RolesList({ roles }: RolesListProps) {
  if (roles.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">No roles yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Key</TableHead>
            <TableHead>Permissions</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roles.map((role) => (
            <TableRow key={role.id}>
              <TableCell className="font-medium">{role.name}</TableCell>
              <TableCell className="font-mono text-sm">{role.key}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {role.isSuperAdmin ? 'All permissions' : `${role.permissions.length} permissions`}
              </TableCell>
              <TableCell>
                <Link href={`/admin/roles/${role.id}`}>
                  <Button variant="ghost" size="sm">Edit</Button>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
