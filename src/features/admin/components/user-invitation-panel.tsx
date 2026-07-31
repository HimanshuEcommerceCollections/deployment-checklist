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

import { resendInvitation, revokeInvitation } from '../actions/users.actions'

interface UserInvitationPanelProps {
  userId: string
  email: string
  invitation: {
    expiresAt: string
    sentCount: number
    lastSentAt: string | null
  }
}

/**
 * Resend and revoke for an account that has not accepted yet.
 *
 * Both operations existed in invitationService from Phase 1 and had no caller, so
 * a missed invitation email was unrecoverable from the UI — the only options were
 * the database or inviting the same address again.
 */
export function UserInvitationPanel({ userId, email, invitation }: UserInvitationPanelProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expired = new Date(invitation.expiresAt).getTime() < Date.now()

  function onResend() {
    setError(null)
    startTransition(async () => {
      const result = await resendInvitation(userId)

      if (!result.ok) {
        // Most likely the 3-per-hour limit, which the operator has to wait out.
        setError(result.message)
        return
      }

      toast.success(`Invitation re-sent to ${email}`)
      router.refresh()
    })
  }

  function onRevoke() {
    setError(null)
    startTransition(async () => {
      const result = await revokeInvitation(userId)

      if (!result.ok) {
        setError(result.message)
        return
      }

      setConfirmRevoke(false)
      toast.success(`Invitation for ${email} withdrawn`)
      router.push('/admin/users')
    })
  }

  return (
    <div className="space-y-3">
      <dl className="space-y-1 text-sm text-muted-foreground">
        <div>
          <dt className="inline">Link {expired ? 'expired' : 'expires'} </dt>
          <dd className="inline">
            {new Date(invitation.expiresAt).toLocaleString()}
            {expired && ' — resend to issue a fresh one'}
          </dd>
        </div>
        <div>
          <dt className="inline">Sent </dt>
          <dd className="inline">
            {invitation.sentCount} time{invitation.sentCount === 1 ? '' : 's'}
            {invitation.lastSentAt
              ? `, last on ${new Date(invitation.lastSentAt).toLocaleString()}`
              : ''}
          </dd>
        </div>
      </dl>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onResend} disabled={pending}>
          {pending ? 'Working…' : 'Resend invitation'}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setConfirmRevoke(true)}
          disabled={pending}
        >
          Withdraw invitation
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Resending issues a new link and kills the previous one, so an older email in their inbox
        stops working.
      </p>

      <Dialog open={confirmRevoke} onOpenChange={(next) => !pending && setConfirmRevoke(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw the invitation for {email}?</DialogTitle>
            <DialogDescription>
              The link stops working and the placeholder account is removed, so the user list stops
              showing someone who has no access. You can invite the same address again afterwards.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRevoke(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onRevoke} disabled={pending}>
              {pending ? 'Withdrawing…' : 'Withdraw'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
