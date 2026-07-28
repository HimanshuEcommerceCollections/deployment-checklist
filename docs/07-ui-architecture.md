# 7 — UI Architecture

Covers deliverables **9** (component hierarchy) and **10** (state management).

The attached HTML is the visual target. What survives: the dark launch-console aesthetic, the SVG progress ring, collapsible numbered panels, the GO/HOLD readout, monospace for numerics, and the `prefers-reduced-motion` and print handling it already got right. What does not: hardcoded `DATA`, `localStorage` persistence, `innerHTML` construction, and `document.getElementById` wiring.

---

## 7.1 Design tokens

The HTML's CSS custom properties become Tailwind v4 theme tokens, so the palette is available as utilities (`bg-panel`, `text-go`, `border-line`) with real light-mode counterparts.

```css
/* src/app/globals.css */
@import 'tailwindcss';
@plugin 'tailwindcss-animate';

@custom-variant dark (&:is(.dark *));

@theme {
  /* ── Launch-console palette, lifted from the reference HTML ─────────── */
  --color-go:      oklch(0.78 0.16 158);   /* #35d68f  ready / complete */
  --color-hold:    oklch(0.79 0.14 78);    /* #f0b54c  in progress      */
  --color-blocked: oklch(0.65 0.19 18);    /* #ef5f6b  blocked / failed */
  --color-cyan:    oklch(0.78 0.11 216);   /* #4fc7e8  accent           */

  --font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Consolas, monospace;
  --font-sans: 'Inter', 'Segoe UI', system-ui, sans-serif;

  /* The eyebrow / status-label treatment from the HTML, as a token. */
  --tracking-console: 0.16em;
  --radius: 0.75rem;
}

/* Semantic surface tokens. Dark is the design's home; light is derived. */
:root {
  --background: oklch(0.99 0.002 250);
  --foreground: oklch(0.21 0.02 255);
  --panel:      oklch(1 0 0);
  --panel-2:    oklch(0.975 0.004 250);
  --line:       oklch(0.91 0.008 250);
  --muted-fg:   oklch(0.47 0.02 255);      /* ≥ 4.5:1 on --background */
  --ring:       var(--color-cyan);
}

.dark {
  --background: oklch(0.16 0.02 260);      /* #0a0e17 */
  --foreground: oklch(0.93 0.01 250);      /* #e7ecf3 */
  --panel:      oklch(0.22 0.03 260);      /* #111a2b */
  --panel-2:    oklch(0.19 0.025 260);     /* #0d1420 */
  --line:       oklch(0.32 0.03 260);      /* #22314a */
  --muted-fg:   oklch(0.68 0.02 255);      /* lifted from #7d8ba3 for contrast */
  --ring:       var(--color-cyan);
}

@layer base {
  * { @apply border-line; }
  body {
    @apply bg-background text-foreground antialiased;
    /* The two radial washes from the reference design. */
    background-image:
      radial-gradient(circle at 15% 0%,   oklch(0.78 0.11 216 / 0.05), transparent 42%),
      radial-gradient(circle at 85% 100%, oklch(0.78 0.16 158 / 0.04), transparent 42%);
    background-attachment: fixed;
  }
  /* Visible focus everywhere — the HTML only had it on checkboxes. */
  :focus-visible { @apply outline-2 outline-offset-2 outline-cyan; }
}

@media print {
  /* Print/Save-PDF from the reference, kept as a first-class feature: a signed
     checklist is a genuine artifact people file with a release. */
  .no-print { display: none !important; }
  [data-state='closed'] .panel-body { display: block !important; height: auto !important; }
  body { background: #fff !important; color: #000 !important; }
}
```

Two deliberate departures from the reference:

**`--muted-fg` was lightened.** `#7d8ba3` on `#111a2b` measures about 4.3:1 — under WCAG AA for body text. It is used for item labels once checked, which is exactly the text a colour-vision-impaired reviewer needs to read. Lifted to clear 4.5:1.

**Line-through alone no longer signals completion.** The HTML uses strikethrough plus dimming, both purely visual. The rebuild keeps them and adds `aria-checked` on the control plus a per-item "checked by Priya, 14:32" line, so completion is conveyed non-visually.

---

## 7.2 Component hierarchy

`S` = Server Component · `C` = Client Component · ★ = derived from the reference HTML

### The console — `/projects/[slug]/deployments/[reference]`

```
page.tsx                                                            S
│  ctx = getRequestContext()  ·  requirePermission(deployment.read)
│  run + itemStates fetched once  ·  readiness computed server-side
│  abilities = serializeAbilities(ctx, […])
│
├─ <DeploymentHeader run>                                           S
│   ├─ <Breadcrumbs>                              project → deployments → APEX-142
│   ├─ <ProjectBadge color>                        ★ eyebrow treatment
│   ├─ <EnvironmentPill environmentKey>            production = blocked-tinted
│   ├─ <StatusPill status>                         ★ status-value
│   └─ <MetaGrid>                                  version · started by · when · duration
│
├─ <LaunchConsole run itemStates readiness abilities>               C ★
│   │   the only stateful island. Owns optimistic state for the whole checklist,
│   │   because the gauge and every panel counter derive from the same tally —
│   │   per-row state would desynchronise them mid-transition.
│   │
│   ├─ <ConsoleHead>                                                C ★
│   │   ├─ <LaunchGauge percent status>            C ★  SVG ring, r=42, dasharray
│   │   ├─ <ReadinessBadge readiness>              C ★  GO / HOLD / BLOCKED
│   │   └─ <OutstandingSummary count reasons>      C    "3 required items left"
│   │
│   ├─ <ChecklistToolbar>                                           C
│   │   ├─ <SearchItems>                            filters across all sections
│   │   ├─ <FilterChips>                            all · outstanding · mine · skipped
│   │   └─ <ExpandCollapseAll>
│   │
│   ├─ <ChecklistSections>                                          C
│   │   └─ <ChecklistSectionPanel>  × n                             C ★
│   │       ├─ <PanelHead>                          ★ Accordion.Trigger
│   │       │   ├─ <PanelIndex>01</PanelIndex>      ★ monospace ordinal
│   │       │   ├─ <PanelTitle>
│   │       │   ├─ <MiniProgressBar value>          ★ mini-bar
│   │       │   ├─ <PanelCount>4/6</PanelCount>     ★
│   │       │   └─ <Chevron>                        ★ rotates on open
│   │       └─ <PanelBody>                          ★ Accordion.Content
│   │           ├─ <SectionBulkAction>              C  "check all" (permission-gated)
│   │           └─ <ChecklistItemRow> × n                           C ★
│   │               ├─ <Checkbox>                   ★ .toggle, optimistic
│   │               ├─ <ItemLabel helpText>         ★ label
│   │               ├─ <RequiredMarker>             C  required vs optional
│   │               ├─ <CheckedByLine>              S-data  who + when
│   │               ├─ <EvidenceIndicator>          C  note / file count
│   │               └─ <ItemActions>                C  note · attach · skip · history
│   │
│   └─ <ConsoleFooter>                                              C ★
│       ├─ <SaveStateNote>                          ★ "Saved automatically" → now real
│       ├─ <PrintButton>                            ★ window.print(), kept
│       └─ <StatusActions abilities readiness>      C
│            start · complete · fail · cancel · rollback — driven by the state machine
│
├─ <Suspense fallback={<TabsSkeleton/>}>                             streamed
│   ├─ <CommentThread deploymentId>                                 S
│   │   ├─ <CommentList>                            S  markdown → sanitised HTML
│   │   │   └─ <CommentItem>                        S  ← <CommentActions> C island
│   │   └─ <CommentComposer>                        C  RHF + markdown editor
│   ├─ <AttachmentPanel deploymentId>                               S
│   │   ├─ <AttachmentList>                         S
│   │   └─ <FileDropzone>                           C  presigned direct upload
│   └─ <DeploymentTimeline deploymentId>                            S  audit-derived
│
└─ <ReleaseNotesCard run>                                           S  markdown
```

The client/server split follows one rule: **a component is a Client Component only if it owns state, handles an event, or uses a browser API.** In the tree above that is the console island (optimistic checklist state), the toolbar (filters), and the form/action islands. Comment bodies, timelines, attachment lists, headers, and markdown rendering are all server-rendered — none of that logic or its dependencies enter the client bundle. Markdown rendering server-side in particular keeps a sanitiser and a parser (~40 KB gzipped) out of the browser entirely.

### Shell

```
app/(app)/layout.tsx                                                S
├─ <AppShell>                                                       S
│   ├─ <Sidebar nav={visibleNav(ctx)}>              S  filtered by permission
│   │   ├─ <NavSection> Dashboard · Deployments · Projects
│   │   ├─ <ProjectSwitcher projects>               C  cmdk combobox
│   │   └─ <NavSection> Admin  (only if admin.access)
│   ├─ <TopBar>                                                     S
│   │   ├─ <MobileNavTrigger>                       C
│   │   ├─ <GlobalSearchTrigger>                    C  ⌘K
│   │   ├─ <ThemeToggle>                            C  next-themes
│   │   └─ <UserMenu user>                          C
│   └─ <main>{children}</main>
├─ <GlobalSearchDialog>                             C  cmdk, lazy-loaded
└─ <Toaster>                                        C  sonner
```

### Template editor — the other genuinely interactive surface

```
versions/[version]/edit/page.tsx                                    S
│  version must be DRAFT; a PUBLISHED version renders read-only with "Clone to draft"
├─ <VersionHeader status version>                                   S
├─ <TemplateEditor sections>                                        C
│   │   dnd-kit; owns the whole ordered tree so cross-section item moves work
│   ├─ <SortableList items={sections}>                              C
│   │   └─ <SectionEditorCard>  × n                                 C
│   │       ├─ <DragHandle>                          keyboard-operable
│   │       ├─ <InlineTextField field="title">
│   │       ├─ <SortableList items={section.items}>  C  nested sortable
│   │       │   └─ <ItemEditorRow> × n               C
│   │       │       ├─ <DragHandle>
│   │       │       ├─ <InlineTextField field="label">
│   │       │       ├─ <RequiredToggle>  <EvidenceToggle>
│   │       │       ├─ <EnvironmentScopePicker>       environment-specific items
│   │       │       └─ <RowMenu>  duplicate · delete · restore
│   │       └─ <AddItemButton>
│   ├─ <AddSectionButton>
│   └─ <DeletedItemsDrawer>                          C  soft-delete restore
├─ <PublishDialog>                                                  C
└─ <UnsavedChangesGuard>                                            C
```

Reordering posts the **full ordered id list** (`PUT …/sections/reorder { orderedSectionIds }`), not a delta. Idempotent, one atomic array write, and immune to the class of bug where two concurrent moves interleave into a nonsensical order.

### Shared components

```
components/ui/            shadcn: button, input, select, checkbox, dialog, sheet,
                          dropdown-menu, accordion, tabs, table, badge, tooltip,
                          popover, command, form, textarea, switch, skeleton, sonner
components/data/          data-table · column-header · pagination-bar · filter-bar
                          empty-state · export-button · search-input
components/forms/         form-field · submit-button · markdown-editor · color-picker
                          file-dropzone · combobox-field
components/primitives/    progress-ring ★ · progress-bar ★ · status-pill ★
                          relative-time · user-avatar · copy-button
components/feedback/      confirm-dialog · error-state · loading-skeletons
```

`<DataTable>` is the reusable core behind the deployment history, project list, user list, and audit viewer: column definitions, URL-driven sorting and pagination, row selection, sticky header, responsive card fallback below `md`, and a loading skeleton that matches the real row height so nothing shifts on load.

---

## 7.3 State management

No global client store. State is placed by **who owns it and how long it lives**:

| Kind of state | Where it lives | Mechanism | Example |
|---|---|---|---|
| Server data | server | RSC + `fetch`/Prisma, `revalidateTag` | run, checklist, comments, history |
| Navigation & filters | **the URL** | `searchParams` + `nuqs` | history filters, page, sort, tab |
| In-flight mutation | the action | `useActionState`, `useFormStatus` | every form submit |
| Optimistic overlay | the island | `useOptimistic` | checklist toggles |
| Form values | the form | React Hook Form + `zodResolver` | project, template, comment |
| Ephemeral UI | the component | `useState` | open panels, popovers |
| Cross-cutting UI prefs | context | `next-themes`, cookie | theme, sidebar collapsed |
| Toasts | module singleton | `sonner` | success and error surfaces |

**Filters in the URL, not in state.** `?status=IN_PROGRESS&project=apex&sort=-createdAt` is shareable, bookmarkable, survives refresh, and — because it is a `searchParams` change — is served by a server render with no client fetching code at all. A `useState` filter panel would need its own data-fetching layer to do less.

### Optimistic checklist toggles

This is the interaction the whole product is judged on. The reference HTML's checkbox responds instantly because it writes to `localStorage`. A network round trip must not make the rebuild feel worse.

```tsx
// src/features/deployments/hooks/use-checklist.ts
export function useChecklist(runId: string, initial: ItemState[], snapshot: ChecklistSnapshot) {
  const [states, applyOptimistic] = useOptimistic(
    initial,
    (current, patch: ItemPatch) =>
      current.map((s) => (s.itemId === patch.itemId ? { ...s, ...patch.changes } : s)),
  )

  // Every counter, panel badge, and the gauge derive from the SAME array, so
  // they cannot disagree — which is the bug a per-row useState would create.
  const progress = useMemo(() => computeProgress(snapshot, states), [snapshot, states])
  const readiness = useMemo(
    () => evaluateReadiness({ snapshot, states: toMap(states), policy: snapshot.completionPolicy }),
    [snapshot, states],
  )

  async function toggle(itemId: string, checked: boolean) {
    const target = states.find((s) => s.itemId === itemId)
    if (!target) return

    applyOptimistic({ itemId, changes: { checked, pending: true } })

    const result = await toggleChecklistItem({ runId, itemId, checked, revision: target.revision })

    if (!result.ok) {
      if (result.code === 'CONFLICT') {
        // Someone else moved first. Their write is authoritative; adopt it
        // quietly rather than showing an error for a normal race.
        toast.info('Updated by someone else')
      } else {
        toast.error(result.message)
      }
      // Either way: refresh from the server. React discards the optimistic
      // value automatically once the action settles and the tree re-renders.
      router.refresh()
    }
  }

  return { states, progress, readiness, toggle }
}
```

`evaluateReadiness` and `computeProgress` are imported from `src/domain/` and run **identically on the server and the client** — pure functions with no I/O. The client cannot compute a different GO state than the server will enforce, which is what makes optimistic rendering of a *gate* safe rather than misleading.

### Concurrent editing

Several engineers on one console during a release window is the normal case, not an edge case. Three mechanisms, in order of cost:

1. **Per-item optimistic concurrency.** `revision` guards each write; a stale write returns `CONFLICT` with the current state and the client adopts it. Two people ticking *different* items never conflict at all.
2. **Refresh on focus.** A `useDeploymentChannel` hook calls `router.refresh()` on window focus and every 30 s while the run is `IN_PROGRESS` (and not at all otherwise, so an idle history page costs nothing).
3. **SSE, later.** The same hook is the seam. `GET /api/v1/deployments/:id/stream` emitting `readiness.changed` would let step 2 be dropped. Deliberately not built yet: polling a run that changes a few times a minute is adequate, and shipping an SSE transport on Vercel has real operational cost.

### Forms

```tsx
const form = useForm<CreateProjectInput>({
  resolver: zodResolver(CreateProjectSchema),   // the same schema the service uses
  defaultValues: { name: '', color: '#4fc7e8', status: 'ACTIVE' },
})

async function onSubmit(values: CreateProjectInput) {
  const result = await createProject(values)
  if (!result.ok) {
    // Server-side field errors land on the right inputs — including rules the
    // client cannot know, like "a project with this key already exists".
    if (result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof CreateProjectInput, { message: messages[0] })
      }
      return
    }
    return void toast.error(result.message)
  }
  toast.success('Project created')
  router.push(`/projects/${result.data.slug}`)
}
```

One schema, three consumers: client validation, action validation, service validation. Uniqueness and cross-entity rules can only be checked server-side, and routing those back to the correct field is what keeps the form from feeling like it is lying.

---

## 7.4 Rendering, loading, and errors

**Server Components by default.** A component becomes `'use client'` only for state, events, or browser APIs. In the console tree that is roughly six components out of thirty.

**Streaming.** The console renders as soon as the run and item states are loaded; comments, attachments, and the timeline stream in behind `<Suspense>`. The checklist — the reason the page exists — is never blocked by a comment query.

**Skeletons match real geometry.** `loading.tsx` renders the header, gauge, and panel shapes at their real sizes, so nothing shifts when data arrives.

**Errors, three levels.** `error.tsx` per route group (recoverable, with retry); `not-found.tsx` for missing or invisible resources; and a `<ForbiddenState>` for `ForbiddenError` that names the missing permission and offers a route back, rather than a bare 403.

**Empty states carry the next action.** "No deployments yet" is paired with a *New deployment* button, permission-gated — an empty state that only says a list is empty is a dead end.

---

## 7.5 Accessibility

The reference HTML got `prefers-reduced-motion` and focus-visible checkboxes right. The rebuild keeps both and closes the rest:

| Concern | Implementation |
|---|---|
| Accordion semantics | Radix Accordion — `aria-expanded`, `aria-controls`, arrow-key navigation. The reference used a clickable `div` with no role |
| Progress ring | `role="progressbar"` with `aria-valuenow/min/max` and `aria-label="Checklist completion"`; the SVG is `aria-hidden` |
| Checkbox groups | each panel is a `<fieldset>` with the section title as its `<legend>` |
| Completion state | `aria-checked` plus a text line, not colour and strikethrough alone |
| Live updates | readiness changes announced via `aria-live="polite"`; per-item toggles are not announced (they would be deafening on bulk actions) |
| Keyboard | full tab order; `Space` toggles; `⌘K` search; drag handles operable with `Space` + arrows via dnd-kit's keyboard sensor |
| Focus management | dialogs trap and restore focus; after a transition, focus moves to the status region |
| Contrast | every token pair ≥ 4.5:1 for text, ≥ 3:1 for UI; verified in CI |
| Motion | `prefers-reduced-motion` disables the gauge tween and panel animation |
| Zoom / reflow | usable at 400 % zoom and 320 px width |
| Forms | every input labelled; errors linked with `aria-describedby` and `aria-invalid` |

CI runs `axe-core` through Playwright on the login, dashboard, console, history, and template-editor routes. Violations fail the build. Automated checks catch maybe half of real accessibility problems, so the drag-and-drop editor and the console also get a manual keyboard-only pass before release — recorded in the release checklist, which is pleasingly recursive.

---

## 7.6 Responsive behaviour

| Breakpoint | Console | History |
|---|---|---|
| `< 640` | gauge above header, panels full-bleed, actions in a sticky bottom bar | card list, filters in a sheet |
| `640–1024` | side-by-side header, sidebar collapses to icons | table with columns dropped by priority |
| `> 1024` | full layout, sidebar expanded | full table |

The reference already collapsed its header below 520 px; that behaviour is preserved at Tailwind's `sm`. Container queries (`@container`) are used for the panel internals so a section panel renders correctly in the console, in a dashboard widget, and in a print layout without breakpoint-specific overrides.

---

## 7.7 Performance budget

| Route | First Load JS | Measured | Target LCP |
|---|---|---|---|
| shared baseline | — | **102 kB** | — |
| `/login` | < 160 kB | 145 kB ✓ | < 1.0 s |
| `/dashboard` | < 200 kB | 183 kB ✓ | < 1.5 s |
| console | < 260 kB | not built yet | < 1.8 s |
| template editor | < 320 kB | not built yet | < 2.0 s |

**Revised against measurement.** The original targets (40–180 kB) were set before the
first build and did not account for the Next 15 + React 19 shared chunk, which is
**102 kB on its own** — so a 40 kB login page was never achievable. Budgets are now
expressed as *First Load JS* (baseline included), which is what `next build` reports and
therefore what CI can actually enforce. The numbers above leave roughly 40 % headroom over
current measurements.

Enforced by `@next/bundle-analyzer` in CI with a size-limit check on the shared chunk. Lazy-loaded, never in the shared bundle: the markdown editor, dnd-kit (editor only), the command palette, chart library (dashboard only), and export helpers. The template editor is allowed the largest budget because dnd-kit is unavoidable there — and it is an admin-only route, not the hot path.
