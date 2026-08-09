'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { createIntegration, deleteIntegration, updateIntegration } from '../actions/integrations.actions'

const TYPES = ['slack', 'github', 'webhook'] as const

export interface IntegrationFormValues {
  id?: string
  type: (typeof TYPES)[number]
  name: string
  config: Record<string, unknown>
  enabled: boolean
}

type State = { error: string | null }

/**
 * Create or edit an integration.
 *
 * `config` is a freeform JSON object on the model (`z.record`), so it is edited
 * as JSON here rather than inventing a per-type field set the server does not
 * validate. Both `/admin/integrations/new` and `/admin/integrations/[id]`
 * previously linked to pages that did not exist (a 404 on every click); this is
 * the missing page, wired to the actions that already existed.
 */
export function IntegrationForm({ initial }: { initial?: IntegrationFormValues }) {
  const router = useRouter()
  const editing = Boolean(initial?.id)

  const [type, setType] = useState<IntegrationFormValues['type']>(initial?.type ?? 'webhook')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [configText, setConfigText] = useState(
    JSON.stringify(initial?.config ?? { url: 'https://example.com/webhook' }, null, 2),
  )
  const [deleting, startDelete] = useTransition()

  const [state, action, pending] = useActionState<State, FormData>(async (_previous, formData) => {
    let config: Record<string, unknown>
    try {
      config = JSON.parse(configText || '{}')
    } catch {
      return { error: 'Configuration must be valid JSON.' }
    }

    const payload = { type, name: String(formData.get('name') ?? '').trim(), config, enabled }
    const result = editing
      ? await updateIntegration(initial!.id!, payload)
      : await createIntegration(payload)

    if (!result.ok) return { error: result.message }

    toast.success(editing ? 'Integration updated' : 'Integration created')
    router.push('/admin/integrations')
    router.refresh()
    return { error: null }
  }, { error: null })

  async function remove() {
    startDelete(async () => {
      const result = await deleteIntegration(initial!.id!)
      if (result.ok) {
        toast.success('Integration deleted')
        router.push('/admin/integrations')
        router.refresh()
      } else {
        toast.error(result.message)
      }
    })
  }

  return (
    <form action={action} className="space-y-4">
      {state.error && (
        <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}

      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={initial?.name} required maxLength={100} disabled={pending} />
      </div>

      <div>
        <Label htmlFor="type">Type</Label>
        <select
          id="type"
          value={type}
          onChange={(event) => setType(event.target.value as IntegrationFormValues['type'])}
          disabled={pending}
          className="mt-1 w-full rounded border border-gray-700 bg-gray-800/60 px-3 py-2 text-sm capitalize"
        >
          {TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label htmlFor="config">Configuration (JSON)</Label>
        <textarea
          id="config"
          value={configText}
          onChange={(event) => setConfigText(event.target.value)}
          disabled={pending}
          rows={6}
          spellCheck={false}
          className="mt-1 w-full rounded border border-gray-700 bg-gray-800/60 px-3 py-2 font-mono text-xs"
        />
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={pending} />
        <span className="text-sm">Enabled</span>
      </label>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Create integration'}
        </Button>
        {editing && (
          <Button type="button" variant="destructive" disabled={deleting} onClick={remove}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        )}
      </div>
    </form>
  )
}
