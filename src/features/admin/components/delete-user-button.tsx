'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { deleteUser } from '../actions/users.actions'

interface DeleteUserButtonProps {
  userId: string
  email: string
  isSelf: boolean
}

export function DeleteUserButton({ userId, email, isSelf }: DeleteUserButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /// Typing the address is deliberate friction. This revokes every session the
  /// person holds, and a misplaced click during an incident is expensive.
  const confirmed = typed.trim().toLowerCase() === email.toLowerCase()

  function onConfirm() {
    setError(null)

    startTransition(async () => {
      const result = await deleteUser(userId)

      if (!result.ok) {
        // Self-deletion and last-administrator are both refused here.
        setError(result.message)
        return
      }

      setOpen(false)
      toast.success(`${email} deleted — restore from Trash if needed`)
      router.push('/admin/users')
    })
  }

  if (isSelf) {
    return (
      <p className="text-sm text-muted-foreground">
        You cannot delete your own account. Ask another administrator, or use{' '}
        <code className="font-mono text-xs">npm run grant:admin</code> to recover access.
      </p>
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        setOpen(next)
        if (!next) {
          setTyped('')
          setError(null)
        }
      }}
    >
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete user
      </Button>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {email}?</DialogTitle>
          <DialogDescription>
            Their sessions end immediately and they can no longer sign in. This is a soft delete —
            an administrator can restore the account from Trash, and the audit trail is kept either
            way.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="confirm-email">
            Type <span className="font-mono">{email}</span> to confirm
          </Label>
          <Input
            id="confirm-email"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            disabled={pending}
            autoComplete="off"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending || !confirmed}>
            {pending ? 'Deleting…' : 'Delete user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
