'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'

import { RouteTransitionOverlay } from '@/components/route-transition-overlay'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
/// Type-only, so the `server-only` guard in that module is erased at compile time.
import type { ActionResult } from '@/lib/http/action-result'

import { createDeployment } from '../actions/deployments.actions'

interface Option {
  id: string
  label: string
  detail?: string
}

interface EnvironmentOption {
  id: string
  name: string
  isProduction: boolean
}

interface NewDeploymentFormProps {
  projectId: string
  projectKey: string
  versions: Option[]
  environments: EnvironmentOption[]
}

/// The action returns the standard ActionResult envelope, where `message` is
/// present only on failure — success carries `data`.
type State = ActionResult<{ id: string }> | null

export function NewDeploymentForm({
  projectId,
  projectKey,
  versions,
  environments,
}: NewDeploymentFormProps) {
  const router = useRouter()
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '')
  const [navigating, setNavigating] = useState(false)

  const selectedEnvironment = environments.find((e) => e.id === environmentId)

  const [state, action, pending] = useActionState<State, FormData>(async (_previous, formData) => {
    const scheduledAtLocal = String(formData.get('scheduledAt') ?? '')

    /**
     * A `datetime-local` value ("2026-08-09T14:30") carries no timezone, and the
     * server's `z.coerce.date()` would read that wall-clock as UTC — so a user in
     * IST scheduling 14:30 stored 14:30 UTC (20:00 IST). Converting here, in the
     * browser, resolves it against the user's own zone and sends a real instant.
     */
    const scheduledAt = scheduledAtLocal ? new Date(scheduledAtLocal).toISOString() : undefined

    const result = await createDeployment({
      projectId,
      templateVersionId: formData.get('templateVersionId'),
      environmentId: formData.get('environmentId'),
      version: String(formData.get('version') ?? '').trim(),
      // The schema is `.strict()`, so an empty optional must be omitted rather
      // than sent as '' — an empty string is not a valid date and would fail
      // coercion on a field the user deliberately left blank.
      title: String(formData.get('title') ?? '').trim() || undefined,
      releaseNotes: String(formData.get('releaseNotes') ?? '').trim() || undefined,
      scheduledAt,
    })

    if (result.ok && 'data' in result && result.data) {
      const created = result.data as { id: string }
      setNavigating(true)
      router.push(`/projects/${projectId}/deployments/${created.id}/checklist`)
    }

    return result
  }, null)

  return (
    <form action={action} className="space-y-4">
      <RouteTransitionOverlay show={navigating} label="Opening the checklist…" />
      {state && !state.ok && (
        <div className="rounded-lg border border-blocked/40 bg-blocked-surface p-4 text-sm text-blocked">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="templateVersionId">Checklist template</Label>
        {/**
         * Radix Select rather than native: the OS-drawn popup ignored the dark
         * theme. `name` renders a hidden native select so formData.get() in the
         * action still reads the value (same pattern as the settings form).
         */}
        <Select name="templateVersionId" defaultValue={versions[0]?.id} disabled={pending}>
          <SelectTrigger id="templateVersionId" className="mt-1 w-full">
            <SelectValue placeholder="Choose a template…" />
          </SelectTrigger>
          <SelectContent>
            {versions.map((version) => (
              <SelectItem key={version.id} value={version.id}>
                {version.label}
                {version.detail ? ` (${version.detail})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          The version&apos;s content is frozen into this run when it is created, so later
          template edits never change a release already in flight.
        </p>
      </div>

      <div>
        <Label htmlFor="environmentId">Environment</Label>
        <Select
          name="environmentId"
          value={environmentId}
          onValueChange={setEnvironmentId}
          disabled={pending}
        >
          <SelectTrigger id="environmentId" className="mt-1 w-full">
            <SelectValue placeholder="Choose an environment…" />
          </SelectTrigger>
          <SelectContent>
            {environments.map((environment) => (
              <SelectItem key={environment.id} value={environment.id}>
                {environment.name}
                {environment.isProduction ? ' — production' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedEnvironment?.isProduction && (
          <p className="mt-1 text-xs text-hold">
            This is a production environment. Every action on this run will additionally
            require the “Deploy to production” permission.
          </p>
        )}
      </div>

      <div>
        <Label htmlFor="version">Release version</Label>
        <Input
          id="version"
          name="version"
          required
          maxLength={50}
          placeholder="2.14.0"
          disabled={pending}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Combined with a per-project sequence into a reference like {projectKey}-1.
        </p>
      </div>

      <div>
        <Label htmlFor="title">Title (optional)</Label>
        <Input id="title" name="title" maxLength={300} disabled={pending} />
      </div>

      <div>
        <Label htmlFor="releaseNotes">Release notes (optional)</Label>
        <Textarea
          id="releaseNotes"
          name="releaseNotes"
          rows={4}
          maxLength={5000}
          disabled={pending}
          placeholder="Markdown supported"
        />
      </div>

      <div>
        <Label htmlFor="scheduledAt">Scheduled for (optional)</Label>
        <Input id="scheduledAt" name="scheduledAt" type="datetime-local" disabled={pending} />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create deployment'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => router.push(`/projects/${projectId}/deployments`)}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}
