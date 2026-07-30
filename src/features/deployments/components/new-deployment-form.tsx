'use client'

import { useRouter } from 'next/navigation'
import { useActionState, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

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

type State = { ok: boolean; message: string } | null

export function NewDeploymentForm({
  projectId,
  projectKey,
  versions,
  environments,
}: NewDeploymentFormProps) {
  const router = useRouter()
  const [environmentId, setEnvironmentId] = useState(environments[0]?.id ?? '')

  const selectedEnvironment = environments.find((e) => e.id === environmentId)

  const [state, action, pending] = useActionState<State, FormData>(async (_previous, formData) => {
    const scheduledAt = String(formData.get('scheduledAt') ?? '')

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
      scheduledAt: scheduledAt || undefined,
    })

    if (result.ok && 'data' in result && result.data) {
      const created = result.data as { id: string }
      router.push(`/projects/${projectId}/deployments/${created.id}/checklist`)
    }

    return result
  }, null)

  return (
    <form action={action} className="space-y-4">
      {state && !state.ok && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {state.message}
        </div>
      )}

      <div>
        <Label htmlFor="templateVersionId">Checklist template</Label>
        <select
          id="templateVersionId"
          name="templateVersionId"
          required
          disabled={pending}
          defaultValue={versions[0]?.id}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              {version.label}
              {version.detail ? ` (${version.detail})` : ''}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          The version&apos;s content is frozen into this run when it is created, so later
          template edits never change a release already in flight.
        </p>
      </div>

      <div>
        <Label htmlFor="environmentId">Environment</Label>
        <select
          id="environmentId"
          name="environmentId"
          required
          disabled={pending}
          value={environmentId}
          onChange={(event) => setEnvironmentId(event.target.value)}
          className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
              {environment.isProduction ? ' — production' : ''}
            </option>
          ))}
        </select>
        {selectedEnvironment?.isProduction && (
          <p className="mt-1 text-xs text-amber-700">
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
        <p className="mt-1 text-xs text-gray-500">
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
