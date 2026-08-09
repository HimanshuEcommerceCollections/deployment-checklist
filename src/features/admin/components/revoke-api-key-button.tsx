'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { revokeApiKey } from '../actions/api-keys.actions'

/**
 * Revoke an API key through the server action.
 *
 * The list previously posted to `/api/admin/api-keys/[id]/revoke`, a route that
 * does not exist, so Revoke navigated to a 404 and the key stayed active. The
 * `revokeApiKey` server action already existed with no caller — this wires it.
 */
export function RevokeApiKeyButton({ keyId, name }: { keyId: string; name: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)

  async function revoke() {
    const result = await revokeApiKey(keyId)
    if (result.ok) {
      toast.success('API key revoked')
      startTransition(() => router.refresh())
    } else {
      toast.error(result.message)
      setConfirming(false)
    }
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <Button variant="destructive" size="sm" disabled={pending} onClick={revoke}>
          {pending ? 'Revoking…' : 'Confirm'}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </span>
    )
  }

  return (
    <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} aria-label={`Revoke ${name}`}>
      Revoke
    </Button>
  )
}
