'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { createDraftTemplateVersion } from '../actions/template-versions.actions'

export interface VersionRow {
  id: string
  version: number
  status: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'
  sectionCount: number
  itemCount: number
  requiredCount: number
  publishedAt: Date | null
  isCurrent: boolean
}

const STATUS_STYLES: Record<VersionRow['status'], string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  DEPRECATED: 'bg-red-100 text-red-800',
}

/**
 * Versions of one template, and the only route into the content editor.
 *
 * "New draft" is what makes a published template editable again — published
 * versions are frozen, so without this the editor can only ever touch a template
 * on the day it was created.
 */
export function TemplateVersionsList({
  templateId,
  versions,
  canManage,
}: {
  templateId: string
  versions: VersionRow[]
  canManage: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const draft = versions.find((version) => version.status === 'DRAFT')

  function newDraft() {
    setError(null)
    startTransition(async () => {
      const result = await createDraftTemplateVersion(templateId, {})
      if (result.ok && result.data) {
        router.push(`/admin/templates/${templateId}/versions/${result.data.id}`)
      } else {
        setError(result.message ?? 'Could not create a draft version.')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Versions</h2>
        {canManage && !draft && (
          <Button size="sm" disabled={pending} onClick={newDraft}>
            {pending ? 'Creating…' : 'New draft'}
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {draft && canManage && (
        <p className="text-sm text-gray-600">
          A draft is open. Publish or delete v{draft.version} before starting another.
        </p>
      )}

      {versions.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-gray-600">
          No versions yet.
        </div>
      ) : (
        <div className="divide-y rounded-lg border">
          {versions.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-4 p-4">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  v{version.version}
                  <Badge className={STATUS_STYLES[version.status]}>{version.status}</Badge>
                  {version.isCurrent && (
                    <Badge className="bg-cyan-100 text-cyan-800">Current</Badge>
                  )}
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  {version.sectionCount} section{version.sectionCount === 1 ? '' : 's'} ·{' '}
                  {version.itemCount} item{version.itemCount === 1 ? '' : 's'} ·{' '}
                  {version.requiredCount} required
                  {version.publishedAt
                    ? ` · published ${version.publishedAt.toISOString().slice(0, 10)}`
                    : ''}
                </p>
              </div>
              <Link href={`/admin/templates/${templateId}/versions/${version.id}`}>
                <Button variant="ghost" size="sm">
                  {version.status === 'DRAFT' && canManage ? 'Edit' : 'View'}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
