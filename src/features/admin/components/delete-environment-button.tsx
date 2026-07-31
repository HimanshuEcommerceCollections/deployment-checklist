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
  DialogTrigger,
} from '@/components/ui/dialog'

import { deleteEnvironment } from '../actions/environments.actions'

interface DeleteEnvironmentButtonProps {
  id: string
  name: string
}

export function DeleteEnvironmentButton({ id, name }: DeleteEnvironmentButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  function onConfirm() {
    startTransition(async () => {
      const result = await deleteEnvironment(id)

      if (result.ok) {
        setOpen(false)
        toast.success(`${name} moved to trash`)
        router.push('/admin/environments')
        return
      }

      /// Keep the dialog open — the common failure is "still used by N
      /// deployments", which the operator has to read and act on.
      toast.error(result.message)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete environment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>
            It moves to the trash, where an administrator can restore it. Deployments already
            recorded against it keep their history either way.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
