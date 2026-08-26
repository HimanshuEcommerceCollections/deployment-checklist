'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
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
  DRAFT: 'bg-muted text-foreground',
  PUBLISHED: 'bg-go-surface text-go',
  DEPRECATED: 'bg-blocked-surface text-blocked',
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
  const [pending, setPending] = useState(false)
  const [, startRefresh] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionTitle, setSectionTitle] = useState('')
  const [sectionDescription, setSectionDescription] = useState('')

  /**
   * The pending confirmation, if any. One dialog serves the four irreversible
   * verbs on this page; publish and deprecate previously fired on a single
   * click, and the deletes went through the native `confirm()`.
   */
  const [confirming, setConfirming] = useState<
    | { kind: 'publish' }
    | { kind: 'deprecate' }
    | { kind: 'delete-section'; sectionId: string; title: string }
    | { kind: 'delete-item'; sectionId: string; itemId: string; label: string }
    | null
  >(null)

  const readOnly = status !== 'DRAFT' || !canManage

  /**
   * Every mutation funnels through here so none can forget to surface a
   * failure. Feedback is a toast — visible wherever the person is on a long
   * template, unlike the old banner at the top of the page — and callers get
   * the outcome back, so a form can stay open (with its input intact) on
   * failure and close only on success.
   */
  async function run(action: () => Promise<{ ok: boolean; message?: string }>): Promise<boolean> {
    setError(null)
    setPending(true)
    try {
      const result = await action()
      setConfirming(null)
      if (result.ok) {
        toast.success(result.message ?? 'Saved')
        startRefresh(() => router.refresh())
        return true
      }
      setError(result.message ?? 'Something went wrong.')
      toast.error(result.message ?? 'Something went wrong.')
      return false
    } finally {
      setPending(false)
    }
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
            {templateName} <span className="text-muted-foreground">v{versionNumber}</span>
          </h1>
          <div className="mt-2 flex items-center gap-3">
            <Badge className={STATUS_STYLES[status]}>{status}</Badge>
            <span className="text-sm text-muted-foreground">
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
              onClick={() => setConfirming({ kind: 'publish' })}
            >
              {pending ? 'Working…' : 'Publish version'}
            </Button>
          )}
          {status === 'PUBLISHED' && canDeprecate && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirming({ kind: 'deprecate' })}
            >
              Deprecate
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-blocked/40 bg-blocked-surface p-4 text-sm text-blocked">
          {error}
        </div>
      )}
      {status !== 'DRAFT' && (
        <div className="rounded-lg border border-hold/40 bg-hold-surface p-4 text-sm text-hold">
          This version is {status.toLowerCase()} and cannot be edited — deployments snapshot their
          checklist from it, so a change here would rewrite history for releases that already
          happened. Start a new draft from the template page to make changes.
        </div>
      )}

      {status === 'DRAFT' && !canManage && (
        <div className="rounded-lg border border-hold/40 bg-hold-surface p-4 text-sm text-hold">
          You do not have permission to edit template content.
        </div>
      )}

      {status === 'DRAFT' && canManage && itemCount === 0 && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          A version cannot be published until it has at least one item.
        </div>
      )}

      <div className="space-y-4">
        {sections.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
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
            onDeleteSection={(sectionId, title) => setConfirming({ kind: 'delete-section', sectionId, title })}
            onMoveSection={moveSection}
            onCreateItem={(sectionId, input: ItemDraft) =>
              run(() => createTemplateItem(templateId, versionId, sectionId, input))
            }
            onUpdateItem={(sectionId, itemId, input: ItemDraft) =>
              run(() => updateTemplateItem(templateId, versionId, sectionId, itemId, input))
            }
            onDeleteItem={(sectionId, itemId, label) =>
              setConfirming({ kind: 'delete-item', sectionId, itemId, label })
            }
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
                  onClick={async () => {
                    // Close only on success — a failure keeps the typed input.
                    const ok = await run(() =>
                      createTemplateSection(templateId, versionId, {
                        title: sectionTitle.trim(),
                        description: sectionDescription.trim() || undefined,
                      }),
                    )
                    if (ok) {
                      setSectionTitle('')
                      setSectionDescription('')
                      setAddingSection(false)
                    }
                  }}
                >
                  {pending ? 'Adding…' : 'Add section'}
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

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(next) => !next && setConfirming(null)}
        pending={pending}
        destructive={confirming?.kind === 'delete-section' || confirming?.kind === 'delete-item'}
        title={
          confirming?.kind === 'publish'
            ? `Publish v${versionNumber}?`
            : confirming?.kind === 'deprecate'
              ? `Deprecate v${versionNumber}?`
              : confirming?.kind === 'delete-section'
                ? `Delete section "${confirming.title}"?`
                : confirming?.kind === 'delete-item'
                  ? `Delete item "${confirming.label}"?`
                  : ''
        }
        description={
          confirming?.kind === 'publish'
            ? 'Publishing freezes this version permanently — its sections and items can never be edited again, and new deployments will offer it. To change it later you clone it into a new draft.'
            : confirming?.kind === 'deprecate'
              ? 'Deprecated versions stop being offered for new deployments and cannot be re-published. Runs already created from it are unaffected.'
              : confirming?.kind === 'delete-section'
                ? 'Every item in this section is deleted with it.'
                : 'This item is removed from the draft.'
        }
        confirmLabel={
          confirming?.kind === 'publish'
            ? 'Publish version'
            : confirming?.kind === 'deprecate'
              ? 'Deprecate version'
              : confirming?.kind === 'delete-section'
                ? 'Delete section'
                : 'Delete item'
        }
        pendingLabel="Working…"
        onConfirm={() => {
          if (!confirming) return
          if (confirming.kind === 'publish') {
            run(() => publishTemplateVersion(templateId, versionId))
          } else if (confirming.kind === 'deprecate') {
            run(() => deprecateTemplateVersion(templateId, versionId))
          } else if (confirming.kind === 'delete-section') {
            run(() => deleteTemplateSection(templateId, versionId, confirming.sectionId))
          } else {
            run(() => deleteTemplateItem(templateId, versionId, confirming.sectionId, confirming.itemId))
          }
        }}
      />
    </div>
  )
}
