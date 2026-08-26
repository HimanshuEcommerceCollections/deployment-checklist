'use client'

import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
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

import type { EditorItem, EditorSection, RoleOption, EnvironmentOption } from './template-version-editor'

/**
 * One section of a draft template version, with its items.
 *
 * Every mutation is a call up to the parent, which owns the pending state and
 * the single error banner. Keeping the server actions in one place there means a
 * failed reorder cannot leave this card showing an order the database rejected.
 */
interface TemplateSectionCardProps {
  section: EditorSection
  index: number
  sectionCount: number
  readOnly: boolean
  pending: boolean
  environments: EnvironmentOption[]
  roles: RoleOption[]
  onUpdateSection: (
    sectionId: string,
    input: { title: string; description: string | null },
  ) => Promise<boolean>
  onDeleteSection: (sectionId: string, title: string) => void
  onMoveSection: (index: number, direction: -1 | 1) => void
  onCreateItem: (sectionId: string, input: ItemDraft) => Promise<boolean>
  onUpdateItem: (sectionId: string, itemId: string, input: ItemDraft) => Promise<boolean>
  onDeleteItem: (sectionId: string, itemId: string, label: string) => void
  onMoveItem: (sectionId: string, index: number, direction: -1 | 1) => void
}

export interface ItemDraft {
  label: string
  helpText: string | null
  key: string | null
  isRequired: boolean
  evidenceRequired: boolean
  ownerRoleKey: string | null
  environmentKeys: string[]
}

function emptyDraft(): ItemDraft {
  return {
    label: '',
    helpText: null,
    key: null,
    isRequired: true,
    evidenceRequired: false,
    ownerRoleKey: null,
    environmentKeys: [],
  }
}

function draftFrom(item: EditorItem): ItemDraft {
  return {
    label: item.label,
    helpText: item.helpText,
    key: item.key,
    isRequired: item.isRequired,
    evidenceRequired: item.evidenceRequired,
    ownerRoleKey: item.ownerRoleKey,
    environmentKeys: item.environmentKeys,
  }
}

export function TemplateSectionCard({
  section,
  index,
  sectionCount,
  readOnly,
  pending,
  environments,
  roles,
  onUpdateSection,
  onDeleteSection,
  onMoveSection,
  onCreateItem,
  onUpdateItem,
  onDeleteItem,
  onMoveItem,
}: TemplateSectionCardProps) {
  const [editingSection, setEditingSection] = useState(false)
  const [title, setTitle] = useState(section.title)
  const [description, setDescription] = useState(section.description ?? '')

  const [addingItem, setAddingItem] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft())

  function beginAddItem() {
    setDraft(emptyDraft())
    setEditingItemId(null)
    setAddingItem(true)
  }

  function beginEditItem(item: EditorItem) {
    setDraft(draftFrom(item))
    setAddingItem(false)
    setEditingItemId(item.id)
  }

  function closeItemForm() {
    setAddingItem(false)
    setEditingItemId(null)
  }

  async function submitItem() {
    if (!draft.label.trim()) return
    const ok = editingItemId
      ? await onUpdateItem(section.id, editingItemId, draft)
      : await onCreateItem(section.id, draft)
    // Close only on success — closing on failure would throw away the draft
    // the person just typed, with the error banner as the only trace.
    if (ok) closeItemForm()
  }

  return (
    <div className="rounded-lg border">
      <div className="flex items-start justify-between gap-4 border-b bg-muted/60 p-4">
        {editingSection ? (
          <div className="flex-1 space-y-3">
            <div>
              <Label htmlFor={`section-title-${section.id}`}>Section title</Label>
              <Input
                id={`section-title-${section.id}`}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={200}
                disabled={pending}
              />
            </div>
            <div>
              <Label htmlFor={`section-desc-${section.id}`}>Description (optional)</Label>
              <Textarea
                id={`section-desc-${section.id}`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                maxLength={1000}
                rows={2}
                disabled={pending}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending || !title.trim()}
                onClick={async () => {
                  const ok = await onUpdateSection(section.id, {
                    title: title.trim(),
                    description: description.trim() || null,
                  })
                  if (ok) setEditingSection(false)
                }}
              >
                {pending ? 'Saving…' : 'Save section'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setTitle(section.title)
                  setDescription(section.description ?? '')
                  setEditingSection(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 font-semibold">
                <span className="text-sm font-normal text-muted-foreground">{index + 1}.</span>
                {section.title}
              </h3>
              {section.description && (
                <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {section.items.length} item{section.items.length === 1 ? '' : 's'}
              </p>
            </div>

            {!readOnly && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move "${section.title}" up`}
                  disabled={pending || index === 0}
                  onClick={() => onMoveSection(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move "${section.title}" down`}
                  disabled={pending || index === sectionCount - 1}
                  onClick={() => onMoveSection(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setEditingSection(true)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-blocked hover:text-blocked"
                  disabled={pending}
                  onClick={() => onDeleteSection(section.id, section.title)}
                >
                  Delete
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="divide-y">
        {section.items.length === 0 && !addingItem && (
          <p className="p-4 text-sm text-muted-foreground">
            No items yet. A section with no items is skipped when a deployment snapshots this
            template.
          </p>
        )}

        {section.items.map((item, itemIndex) =>
          editingItemId === item.id ? (
            <div key={item.id} className="p-4">
              <ItemForm
                draft={draft}
                setDraft={setDraft}
                environments={environments}
                roles={roles}
                pending={pending}
                submitLabel={pending ? 'Saving…' : 'Save item'}
                onSubmit={submitItem}
                onCancel={closeItemForm}
              />
            </div>
          ) : (
            <div key={item.id} className="flex items-start justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span>{item.label}</span>
                  {!item.isRequired && (
                    <Badge className="bg-muted text-foreground">Optional</Badge>
                  )}
                  {item.evidenceRequired && (
                    <Badge className="bg-hold-surface text-hold">Evidence</Badge>
                  )}
                  {item.environmentKeys.length > 0 && (
                    <Badge className="bg-cyan/10 text-cyan">
                      {item.environmentKeys.join(', ')}
                    </Badge>
                  )}
                  {item.ownerRoleKey && (
                    <Badge className="bg-violet-100 text-violet-800">{item.ownerRoleKey}</Badge>
                  )}
                </p>
                {item.helpText && <p className="mt-1 text-xs text-muted-foreground">{item.helpText}</p>}
              </div>

              {!readOnly && (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move "${item.label}" up`}
                    disabled={pending || itemIndex === 0}
                    onClick={() => onMoveItem(section.id, itemIndex, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Move "${item.label}" down`}
                    disabled={pending || itemIndex === section.items.length - 1}
                    onClick={() => onMoveItem(section.id, itemIndex, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => beginEditItem(item)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-blocked hover:text-blocked"
                    disabled={pending}
                    onClick={() => onDeleteItem(section.id, item.id, item.label)}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </div>
          ),
        )}

        {addingItem && (
          <div className="p-4">
            <ItemForm
              draft={draft}
              setDraft={setDraft}
              environments={environments}
              roles={roles}
              pending={pending}
              submitLabel={pending ? 'Adding…' : 'Add item'}
              onSubmit={submitItem}
              onCancel={closeItemForm}
            />
          </div>
        )}
      </div>

      {!readOnly && !addingItem && !editingItemId && (
        <div className="border-t p-3">
          <Button size="sm" variant="ghost" disabled={pending} onClick={beginAddItem}>
            + Add item
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Shared by add and edit so a field added here cannot exist in one and not the
 * other — the usual way an "edit" form quietly drops a value on save.
 *
 * `metadata` is deliberately not editable: it is the free-form extension point
 * for links and external check ids, and a JSON textarea in an admin form is a
 * validation problem with no upside here.
 */
function ItemForm({
  draft,
  setDraft,
  environments,
  roles,
  pending,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  draft: ItemDraft
  setDraft: (next: ItemDraft) => void
  environments: EnvironmentOption[]
  roles: RoleOption[]
  pending: boolean
  submitLabel: string
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div className="space-y-3 rounded-md bg-muted p-4">
      <div>
        <Label htmlFor="item-label">Item</Label>
        <Input
          id="item-label"
          value={draft.label}
          onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          placeholder="Backup taken immediately before migration runs"
          maxLength={500}
          disabled={pending}
        />
      </div>

      <div>
        <Label htmlFor="item-help">Help text (optional)</Label>
        <Textarea
          id="item-help"
          value={draft.helpText ?? ''}
          onChange={(event) => setDraft({ ...draft, helpText: event.target.value || null })}
          placeholder="Record the snapshot id or backup timestamp."
          maxLength={2000}
          rows={2}
          disabled={pending}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="item-key">Business key (optional)</Label>
          <Input
            id="item-key"
            value={draft.key ?? ''}
            onChange={(event) => setDraft({ ...draft, key: event.target.value || null })}
            placeholder="sonar-passed"
            maxLength={100}
            disabled={pending}
          />
        </div>
        <div>
          <Label htmlFor="item-owner">Usual owner (optional)</Label>
          <Select
            value={draft.ownerRoleKey ?? 'anyone'}
            onValueChange={(value) =>
              setDraft({ ...draft, ownerRoleKey: value === 'anyone' ? null : value })
            }
            disabled={pending}
          >
            <SelectTrigger id="item-owner" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* Radix refuses an empty item value, so "anyone" stands in for null. */}
              <SelectItem value="anyone">Anyone</SelectItem>
              {roles.map((role) => (
                <SelectItem key={role.key} value={role.key}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.isRequired}
            onChange={(event) => setDraft({ ...draft, isRequired: event.target.checked })}
            disabled={pending}
          />
          Required to complete the deployment
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.evidenceRequired}
            onChange={(event) => setDraft({ ...draft, evidenceRequired: event.target.checked })}
            disabled={pending}
          />
          Needs a note as evidence before it can be ticked
        </label>
      </div>

      {environments.length > 0 && (
        <fieldset>
          <legend className="text-sm font-medium">Environments</legend>
          <p className="text-xs text-muted-foreground">
            Leave all unchecked to include this item in every environment.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {environments.map((environment) => (
              <label key={environment.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.environmentKeys.includes(environment.key)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      environmentKeys: event.target.checked
                        ? [...draft.environmentKeys, environment.key]
                        : draft.environmentKeys.filter((key) => key !== environment.key),
                    })
                  }
                  disabled={pending}
                />
                {environment.name}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex gap-2">
        <Button size="sm" disabled={pending || !draft.label.trim()} onClick={onSubmit}>
          {submitLabel}
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
