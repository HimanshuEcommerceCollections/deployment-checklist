'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import {
  createTemplateItem,
  createTemplateSection,
  deleteTemplateItem,
  deleteTemplateSection,
  deprecateTemplateVersion,
  publishTemplateVersion,
  reorderTemplateItems,
  reorderTemplateSections,
  updateTemplateItem,
  updateTemplateSection,
} from '../actions/template-versions.actions'
import { type ItemDraft, TemplateSectionCard } from './template-section-card'

export interface EditorItem {
  id: string
  key: string | null
  label: string
  helpText: string | null
  order: number
  isRequired: boolean
  evidenceRequired: boolean
  ownerRoleKey: string | null
  environmentKeys: string[]
}

export interface EditorSection {
  id: string
  key: string | null
  title: string
  description: string | null
  order: number
  items: EditorItem[]
}

export interface EnvironmentOption {
  key: string
  name: string
}

export interface RoleOption {
  key: string
  name: string
}

interface TemplateVersionEditorProps {
  templateId: string
  templateName: string
  versionId: string
  versionNumber: number
  status: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED'
  sections: EditorSection[]
  itemCount: number
  requiredCount: number
  environments: EnvironmentOption[]
  roles: RoleOption[]
  canManage: boolean
  canPublish: boolean
  canDeprecate: boolean
}

const STATUS_STYLES: Record<TemplateVersionEditorProps['status'], string> = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PUBLISHED: 'bg-green-100 text-green-800',
  DEPRECATED: 'bg-red-100 text-red-800',
}

/**
 * Move one id by one position, returning the full new order.
 *
 * Returns null when the move would fall off either end, so the caller sends
 * nothing rather than an order identical to the current one.
 */
function moved(ids: string[], index: number, direction: -1 | 1): string[] | null {
  const target = index + direction
  if (target < 0 || target >= ids.length) return null

  const next = [...ids]
  const [lifted] = next.splice(index, 1)
  if (lifted === undefined) return null
  next.splice(target, 0, lifted)
  return next
}

/**
 * Content editor for a template version.
 *
 * Only DRAFT versions are editable — published ones are frozen because
 * deployment runs snapshot from them, so editing one would rewrite the checklist
 * of releases that already happened. The service enforces that; this component
 * hides the controls so nobody discovers the rule via an error message.
 *
 * All server-action calls live here rather than in the section cards: one place
 * owns the pending flag and the error banner, and `router.refresh()` re-reads the
 * server's ordering after every mutation instead of trusting local state to have
 * guessed it. Sections and items are embedded arrays rewritten wholesale by the
 * service, so the server's copy is the only ordering worth believing.
 */
export function TemplateVersionEditor({
  templateId,
  templateName,
  versionId,
  versionNumber,
  status,
  sections,
  itemCount,
  requiredCount,
  environments,
  roles,
  canManage,
  canPublish,
  canDeprecate,
}: TemplateVersionEditorProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionTitle, setSectionTitle] = useState('')
  const [sectionDescription, setSectionDescription] = useState('')

  const readOnly = status !== 'DRAFT' || !canManage

  /** Every mutation funnels through here so none can forget to surface a failure. */
  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await action()
      if (result.ok) {
        setNotice(result.message ?? null)
        router.refresh()
      } else {
        setError(result.message ?? 'Something went wrong.')
      }
    })
  }

  function moveSection(index: number, direction: -1 | 1) {
    const orderedIds = moved(
      sections.map((section) => section.id),
      index,
      direction,
    )
    if (!orderedIds) return
    run(() => reorderTemplateSections(templateId, versionId, { orderedIds }))
  }

  function moveItem(sectionId: string, index: number, direction: -1 | 1) {
    const section = sections.find((s) => s.id === sectionId)
    if (!section) return
    const orderedIds = moved(
      section.items.map((item) => item.id),
      index,
      direction,
    )
    if (!orderedIds) return
    run(() => reorderTemplateItems(templateId, versionId, sectionId, { orderedIds }))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            {templateName} <span className="text-gray-500">v{versionNumber}</span>
          </h1>
          <div className="mt-2 flex items-center gap-3">
            <Badge className={STATUS_STYLES[status]}>{status}</Badge>
            <span className="text-sm text-gray-600">
              {sections.length} section{sections.length === 1 ? '' : 's'} · {itemCount} item
              {itemCount === 1 ? '' : 's'} · {requiredCount} required
            </span>
          </div>
        </div>

        <div className="flex gap-2">
          {status === 'DRAFT' && canPublish && (
            <Button
              disabled={pending || itemCount === 0}
              title={itemCount === 0 ? 'Add at least one item before publishing' : undefined}
              onClick={() => run(() => publishTemplateVersion(templateId, versionId))}
            >
              {pending ? 'Working…' : 'Publish version'}
            </Button>
          )}
          {status === 'PUBLISHED' && canDeprecate && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => deprecateTemplateVersion(templateId, versionId))}
            >
              Deprecate
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
          {notice}
        </div>
      )}

      {status !== 'DRAFT' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          This version is {status.toLowerCase()} and cannot be edited — deployments snapshot their
          checklist from it, so a change here would rewrite history for releases that already
          happened. Start a new draft from the template page to make changes.
        </div>
      )}

      {status === 'DRAFT' && !canManage && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          You do not have permission to edit template content.
        </div>
      )}

      {status === 'DRAFT' && canManage && itemCount === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-gray-600">
          A version cannot be published until it has at least one item.
        </div>
      )}

      <div className="space-y-4">
        {sections.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-gray-600">
            No sections yet.
          </div>
        )}

        {sections.map((section, index) => (
          <TemplateSectionCard
            key={section.id}
            section={section}
            index={index}
            sectionCount={sections.length}
            readOnly={readOnly}
            pending={pending}
            environments={environments}
            roles={roles}
            onUpdateSection={(sectionId, input) =>
              run(() => updateTemplateSection(templateId, versionId, sectionId, input))
            }
            onDeleteSection={(sectionId, title) => {
              if (!confirm(`Delete section "${title}" and all of its items?`)) return
              run(() => deleteTemplateSection(templateId, versionId, sectionId))
            }}
            onMoveSection={moveSection}
            onCreateItem={(sectionId, input: ItemDraft) =>
              run(() => createTemplateItem(templateId, versionId, sectionId, input))
            }
            onUpdateItem={(sectionId, itemId, input: ItemDraft) =>
              run(() => updateTemplateItem(templateId, versionId, sectionId, itemId, input))
            }
            onDeleteItem={(sectionId, itemId, label) => {
              if (!confirm(`Delete item "${label}"?`)) return
              run(() => deleteTemplateItem(templateId, versionId, sectionId, itemId))
            }}
            onMoveItem={moveItem}
          />
        ))}
      </div>

      {!readOnly && (
        <div className="rounded-lg border border-dashed p-4">
          {addingSection ? (
            <div className="space-y-3">
              <div>
                <Label htmlFor="new-section-title">Section title</Label>
                <Input
                  id="new-section-title"
                  value={sectionTitle}
                  onChange={(event) => setSectionTitle(event.target.value)}
                  placeholder="Database &amp; Data"
                  maxLength={200}
                  disabled={pending}
                />
              </div>
              <div>
                <Label htmlFor="new-section-desc">Description (optional)</Label>
                <Textarea
                  id="new-section-desc"
                  value={sectionDescription}
                  onChange={(event) => setSectionDescription(event.target.value)}
                  placeholder="Only applies to releases carrying schema or data changes."
                  maxLength={1000}
                  rows={2}
                  disabled={pending}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={pending || !sectionTitle.trim()}
                  onClick={() => {
                    run(() =>
                      createTemplateSection(templateId, versionId, {
                        title: sectionTitle.trim(),
                        description: sectionDescription.trim() || undefined,
                      }),
                    )
                    setSectionTitle('')
                    setSectionDescription('')
                    setAddingSection(false)
                  }}
                >
                  Add section
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setSectionTitle('')
                    setSectionDescription('')
                    setAddingSection(false)
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="ghost" disabled={pending} onClick={() => setAddingSection(true)}>
              + Add section
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
