'use client'

import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  /** Names the consequence, not "OK" — "Delete section", "Publish version". */
  confirmLabel: string
  /** Label swapped in while the action runs, e.g. "Deleting…". */
  pendingLabel?: string
  destructive?: boolean
  pending?: boolean
  /** Disables the confirm button beyond `pending` — e.g. a type-the-name gate. */
  confirmDisabled?: boolean
  onConfirm: () => void
  /** Extra content between the description and the buttons (inputs, warnings). */
  children?: ReactNode
}

/**
 * The one confirmation dialog, so every irreversible action asks the same way.
 *
 * Several flows used the native `confirm()` (blocking, unthemed, easily
 * mistaken for a browser warning) or nothing at all; this replaces both. The
 * caller owns the open state and the pending flag, so the dialog can stay
 * open and disabled while the action round-trips.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {children}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
          >
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
