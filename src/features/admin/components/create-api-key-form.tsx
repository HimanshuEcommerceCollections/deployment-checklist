'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { createApiKey } from '../actions/api-keys.actions'

const SCOPES = [
  { value: 'read:deployments', label: 'Read deployments' },
  { value: 'write:deployments', label: 'Write deployments' },
  { value: 'read:templates', label: 'Read templates' },
  { value: 'read:projects', label: 'Read projects' },
] as const

type State = { error: string | null; token: string | null }

/**
 * Create an API key and reveal its plaintext token exactly once.
 *
 * The previous version passed the raw server action to `<form action>`, so the
 * action received a FormData object, the strict schema rejected it, and every
 * submit failed silently — and even had it worked, the one-time token was never
 * shown, which is the whole point of creating a key. This drives the action
 * through `useActionState`, reads the envelope, and surfaces the token.
 */
export function CreateApiKeyForm() {
  const [copied, setCopied] = useState(false)

  const [state, action, pending] = useActionState<State, FormData>(
    async (_previous, formData) => {
      const expiresRaw = formData.get('expiresInDays')
      const result = await createApiKey({
        name: String(formData.get('name') ?? '').trim(),
        scopes: formData.getAll('scopes').map(String),
        expiresInDays: expiresRaw ? Number(expiresRaw) : undefined,
      })

      if (!result.ok) return { error: result.message, token: null }
      return { error: null, token: result.data.token }
    },
    { error: null, token: null },
  )

  if (state.token) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-200">
            Copy this key now — it is shown only once.
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            It is stored only as a hash. If you lose it, revoke this key and create another.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm">
              {state.token}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(state.token!)
                setCopied(true)
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
        <Link href="/admin/api-keys">
          <Button>Done</Button>
        </Link>
      </div>
    )
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div>
        <Label htmlFor="name">Key name</Label>
        <Input id="name" name="name" placeholder="e.g. GitHub Actions" required maxLength={100} disabled={pending} />
      </div>

      <div>
        <Label htmlFor="expiresInDays">Expires in (days)</Label>
        <Input
          id="expiresInDays"
          name="expiresInDays"
          type="number"
          min="1"
          placeholder="Leave empty for no expiry"
          disabled={pending}
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Scopes</legend>
        {SCOPES.map((scope) => (
          <label key={scope.value} className="flex items-center gap-2">
            <input type="checkbox" name="scopes" value={scope.value} disabled={pending} />
            <span className="text-sm">{scope.label}</span>
          </label>
        ))}
      </fieldset>

      <Button type="submit" disabled={pending}>
        {pending ? 'Creating…' : 'Create key'}
      </Button>
    </form>
  )
}
