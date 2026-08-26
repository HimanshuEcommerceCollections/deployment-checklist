'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'

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

import { restoreFromTrash } from '../actions/trash.actions'
import type { TrashEntry, TrashKind } from '../server/trash-service'

/** Serialised over the RSC boundary, so `deletedAt` arrives as a string. */
export type TrashRow = Omit<TrashEntry, 'deletedAt'> & { deletedAt: string }

interface TrashListProps {
  entries: TrashRow[]
}

const KIND_LABEL: Record<TrashKind, string> = {
  project: 'Project',
  template: 'Template',
  environment: 'Environment',
  user: 'User',
}

const KIND_STYLE: Record<TrashKind, string> = {
  project: 'bg-cyan/10 text-cyan',
  template: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
  environment: 'bg-hold-surface text-hold',
  user: 'bg-muted text-foreground',
}

export function TrashList({ entries }: TrashListProps) {
  const [pending, startTransition] = useTransition()

  /// Which row is in flight, so only that button shows a spinner rather than
  /// every button in the table disabling at once.
  const [busyId, setBusyId] = useState<string | null>(null)

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground">
          Trash is empty. Deleted projects, templates, environments and users appear here.
        </p>
      </div>
    )
  }

  function onRestore(entry: TrashRow) {
    setBusyId(entry.id)

    startTransition(async () => {
      const result = await restoreFromTrash({ kind: entry.kind, id: entry.id })
      setBusyId(null)

      if (result.ok) {
        toast.success(
          entry.kind === 'user'
            ? `${entry.label} restored — still deactivated until you reactivate them`
            : `${entry.label} restored`,
        )
      } else {
        /// The service's own message is the useful one here: a key collision or a
        /// missing permission each need a different action from the operator.
        toast.error(result.message)
      }
    })
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Identifier</TableHead>
            <TableHead>Deleted</TableHead>
            <TableHead>By</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <TableRow key={`${entry.kind}:${entry.id}`}>
              <TableCell>
                <Badge className={KIND_STYLE[entry.kind]}>{KIND_LABEL[entry.kind]}</Badge>
              </TableCell>
              <TableCell className="font-medium">{entry.label}</TableCell>
              <TableCell className="font-mono text-sm text-muted-foreground">
                {entry.detail ?? '—'}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <time dateTime={entry.deletedAt}>
                  {new Date(entry.deletedAt).toLocaleString()}
                </time>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {entry.deletedBy ?? '—'}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!entry.canRestore || pending}
                  title={
                    entry.canRestore
                      ? undefined
                      : `You do not have permission to restore a ${KIND_LABEL[entry.kind].toLowerCase()}.`
                  }
                  onClick={() => onRestore(entry)}
                >
                  {busyId === entry.id ? 'Restoring…' : 'Restore'}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
