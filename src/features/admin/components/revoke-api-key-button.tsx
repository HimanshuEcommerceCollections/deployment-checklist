'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'

import { revokeApiKey } from '../actions/api-keys.actions'

/**
 * Revoke an API key through the server action.
 *
 * The list previously posted to `/api/admin/api-keys/[id]/revoke`, a route that
 * does not exist, so Revoke navigated to a 404 and the key stayed active. Now it
 * asks through the same confirmation dialog every destructive action uses.
 */
export function RevokeApiKeyButton({ keyId, name }: { keyId: string; name: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  function revoke() {
    startTransition(async () => {
      const result = await revokeApiKey(keyId)
      setConfirming(false)
      if (result.ok) {
        toast.success('API key revoked')
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Revoke ${name}`}>
        Revoke
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Revoke "${name}"?`}
        description="Anything authenticating with this key stops working immediately. A revoked key cannot be reactivated — create a new one instead."
        confirmLabel="Revoke key"
        pendingLabel="Revoking…"
        destructive
        pending={pending}
        onConfirm={revoke}
      />
    </>
  )
}
