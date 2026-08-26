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
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { Environment } from '@prisma/client'

interface EnvironmentsListProps {
  environments: Environment[]
}

export function EnvironmentsList({ environments }: EnvironmentsListProps) {
  if (environments.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">No environments yet.</p>
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
            <TableHead>Type</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {environments.map((env) => (
            <TableRow key={env.id}>
              <TableCell className="font-medium">{env.name}</TableCell>
              <TableCell className="font-mono text-sm">{env.key}</TableCell>
              <TableCell>
                <Badge className={env.isProduction ? 'bg-blocked-surface text-blocked' : 'bg-cyan/10 text-cyan'}>
                  {env.isProduction ? 'Production' : 'Non-Prod'}
                </Badge>
              </TableCell>
              <TableCell>
                <Link href={`/admin/environments/${env.id}`}>
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
