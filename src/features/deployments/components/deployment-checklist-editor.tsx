'use client'

import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import {
  addChecklistItem,
  addChecklistSection,
  removeChecklistItem,
  removeChecklistSection,
  updateChecklistItem,
  updateChecklistSection,
} from '../actions/deployments.actions'

/**
 * Checklist tailoring controls, rendered only on DRAFT runs for holders of
 * `deployment.edit`. Every control calls its server action and refreshes the
 * route — the server is the sole authority on what a draft may become.
 */

type ActionOutcome = { ok: boolean; message?: string }

function useAction() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<ActionOutcome>, done?: () => void) => {
    setBusy(true)
    try {
      const result = await work()
      if (!result.ok) {
        toast.error(result.message ?? 'That change was not saved.')
        return
      }
      done?.()
      startTransition(() => router.refresh())
    } catch {
      toast.error('Could not reach the server. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  return { run, busy }
}

const inputClass =
  'w-full rounded border border-line bg-panel-2 px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-go/60 focus:outline-none disabled:opacity-50'

interface ItemDraft {
  label: string
  helpText: string
  isRequired: boolean
  evidenceRequired: boolean
}

function ItemForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: ItemDraft
  busy: boolean
  submitLabel: string
  onSubmit: (draft: ItemDraft) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)

  return (
    <div className="border-line bg-panel-2/50 space-y-2 rounded-md border p-3">
      <input
        autoFocus
        value={draft.label}
        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        placeholder="What has to be verified? e.g. 'Robots.txt allows crawlers'"
        maxLength={300}
        disabled={busy}
        className={inputClass}
      />
      <textarea
        value={draft.helpText}
        onChange={(e) => setDraft({ ...draft, helpText: e.target.value })}
        placeholder="Optional help text — how to verify it"
        rows={2}
        maxLength={1000}
        disabled={busy}
        className={inputClass}
      />
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.isRequired}
            onChange={(e) => setDraft({ ...draft, isRequired: e.target.checked })}
            disabled={busy}
          />
          Required for the gate
        </label>
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={draft.evidenceRequired}
            onChange={(e) => setDraft({ ...draft, evidenceRequired: e.target.checked })}
            disabled={busy}
          />
          Evidence note required
        </label>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSubmit(draft)} disabled={busy || !draft.label.trim()}>
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AddItemControl({
  deploymentId,
  sectionId,
}: {
  deploymentId: string
  sectionId: string
}) {
  const { run, busy } = useAction()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <div className="no-print px-6 py-3">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus size={14} aria-hidden /> Add item
        </Button>
      </div>
    )
  }

  return (
    <div className="no-print px-6 py-3">
      <ItemForm
        initial={{ label: '', helpText: '', isRequired: true, evidenceRequired: false }}
        busy={busy}
        submitLabel="Add item"
        onCancel={() => setOpen(false)}
        onSubmit={(draft) =>
          run(
            () =>
              addChecklistItem(deploymentId, sectionId, {
                label: draft.label.trim(),
                helpText: draft.helpText.trim() || null,
                isRequired: draft.isRequired,
                evidenceRequired: draft.evidenceRequired,
              }),
            () => setOpen(false),
          )
        }
      />
    </div>
  )
}

export function ItemEditControls({
  deploymentId,
  item,
}: {
  deploymentId: string
  item: {
    id: string
    label: string
    helpText?: string | null
    isRequired: boolean
    evidenceRequired?: boolean
  }
}) {
  const { run, busy } = useAction()
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="no-print mt-2">
        <ItemForm
          initial={{
            label: item.label,
            helpText: item.helpText ?? '',
            isRequired: item.isRequired,
            evidenceRequired: item.evidenceRequired ?? false,
          }}
          busy={busy}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={(draft) =>
            run(
              () =>
                updateChecklistItem(deploymentId, item.id, {
                  label: draft.label.trim(),
                  helpText: draft.helpText.trim() || null,
                  isRequired: draft.isRequired,
                  evidenceRequired: draft.evidenceRequired,
                }),
              () => setEditing(false),
            )
          }
        />
      </div>
    )
  }

  return (
    <span className="no-print ml-auto flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Edit "${item.label}"`}
        disabled={busy}
        onClick={() => setEditing(true)}
      >
        <Pencil size={14} aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Remove "${item.label}"`}
        disabled={busy}
        onClick={() => {
          if (window.confirm(`Remove "${item.label}" from this checklist?`)) {
            void run(() => removeChecklistItem(deploymentId, item.id))
          }
        }}
      >
        <Trash2 size={14} aria-hidden className="text-blocked" />
      </Button>
    </span>
  )
}

export function SectionEditBar({
  deploymentId,
  section,
}: {
  deploymentId: string
  section: { id: string; title: string; description?: string | null; itemCount: number }
}) {
  const { run, busy } = useAction()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(section.title)
  const [description, setDescription] = useState(section.description ?? '')

  if (editing) {
    return (
      <div className="no-print border-line bg-panel-2/50 space-y-2 border-b px-6 py-3">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          disabled={busy}
          className={inputClass}
          aria-label="Section title"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
          rows={2}
          maxLength={1000}
          disabled={busy}
          className={inputClass}
          aria-label="Section description"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !title.trim()}
            onClick={() =>
              run(
                () =>
                  updateChecklistSection(deploymentId, section.id, {
                    title: title.trim(),
                    description: description.trim() || null,
                  }),
                () => setEditing(false),
              )
            }
          >
            {busy ? 'Saving…' : 'Save section'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="no-print border-line flex items-center justify-end gap-1 border-b px-6 py-1.5">
      <span className="text-muted-foreground mr-auto font-mono text-[10px] uppercase tracking-wider">
        Draft — checklist editable
      </span>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(true)}>
        <Pencil size={14} aria-hidden /> Edit section
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          const what =
            section.itemCount > 0
              ? `"${section.title}" and its ${section.itemCount} item${section.itemCount === 1 ? '' : 's'}`
              : `"${section.title}"`
          if (window.confirm(`Remove ${what} from this checklist?`)) {
            void run(() => removeChecklistSection(deploymentId, section.id))
          }
        }}
      >
        <Trash2 size={14} aria-hidden className="text-blocked" /> Remove
      </Button>
    </div>
  )
}

export function AddSectionControl({ deploymentId }: { deploymentId: string }) {
  const { run, busy } = useAction()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  if (!open) {
    return (
      <div className="no-print">
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Plus size={14} aria-hidden /> Add section
        </Button>
      </div>
    )
  }

  return (
    <div className="no-print border-line bg-panel space-y-2 rounded-lg border p-4">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Section title, e.g. 'Project-specific checks'"
        maxLength={200}
        disabled={busy}
        className={inputClass}
        aria-label="New section title"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Optional description"
        rows={2}
        maxLength={1000}
        disabled={busy}
        className={inputClass}
        aria-label="New section description"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={busy || !title.trim()}
          onClick={() =>
            run(
              () =>
                addChecklistSection(deploymentId, {
                  title: title.trim(),
                  description: description.trim() || null,
                }),
              () => {
                setOpen(false)
                setTitle('')
                setDescription('')
              },
            )
          }
        >
          {busy ? 'Saving…' : 'Add section'}
        </Button>
      </div>
    </div>
  )
}
