import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import {
  ChecklistPdfDocument,
  type ChecklistPdfData,
} from '@/features/deployments/components/checklist-pdf-document'

/**
 * `ChecklistPdfDocument` returns a `<Document>` but its own props are `{ data }`,
 * so its element type does not structurally match react-pdf's `DocumentProps`.
 * The engine renders it fine; the cast is only to satisfy `renderToBuffer`'s
 * parameter type. Isolated here so the tests below stay readable.
 */
const render = (data: ChecklistPdfData) =>
  renderToBuffer(
    createElement(ChecklistPdfDocument, { data }) as Parameters<typeof renderToBuffer>[0],
  )

/**
 * Renders the PDF document through the real layout engine.
 *
 * react-pdf throws at render time for mistakes the type system cannot see —
 * an invalid style value, text outside a <Text>, a bad nesting. In the app the
 * document only renders when someone presses Save PDF, which is exactly the
 * wrong moment to find out. This is the same engine, in Node.
 */

const data: ChecklistPdfData = {
  reference: 'APEX-49',
  title: 'Checkout hotfix',
  templateName: 'Production Deployment',
  templateVersion: 3,
  projectName: 'Apex',
  projectKey: 'APEX',
  version: '2.14.1',
  environmentName: 'Staging',
  isProduction: false,
  status: 'In progress',
  gate: 'HOLD',
  gateDetail: '3 required items still outstanding.',
  startedLabel: '06/08/2026, 10:15:00 by Priya Kulkarni',
  completedLabel: '—',
  progressLabel: '42/45 accounted for',
  generatedLabel: 'Generated 06/08/2026, 11:00:00',
  sections: [
    {
      title: 'Database & Data',
      description: 'Only applies to releases carrying schema or data changes.',
      accounted: 2,
      items: [
        {
          label: 'Backup taken immediately before migration runs',
          helpText: 'Record the snapshot id or backup timestamp.',
          isRequired: true,
          checked: true,
          skipped: false,
          note: 'snapshot-2026-08-06-0915',
          checkedLabel: 'Priya Kulkarni · 06/08/2026, 10:20:00',
        },
        {
          label: 'Rollback script rehearsed',
          helpText: null,
          isRequired: true,
          checked: false,
          skipped: false,
          note: null,
          checkedLabel: null,
        },
        {
          label: 'Read replica lag verified',
          helpText: null,
          isRequired: false,
          checked: false,
          skipped: true,
          note: 'No replica in staging.',
          checkedLabel: null,
        },
      ],
    },
    // A tall second section proves pagination and the fixed footer survive
    // flowing past one page.
    {
      title: 'Verification',
      description: null,
      accounted: 0,
      items: Array.from({ length: 60 }, (_, i) => ({
        label: `Synthetic check ${i + 1} for page-break behaviour`,
        helpText: 'Padding item — real templates run to 49.',
        isRequired: i % 2 === 0,
        checked: false,
        skipped: false,
        note: null,
        checkedLabel: null,
      })),
    },
  ],
}

describe('ChecklistPdfDocument', () => {
  it('renders a multi-page PDF without throwing', async () => {
    const buffer = await render(data)

    // %PDF magic bytes, and a size that cannot be an empty shell.
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(5_000)

    // 63 item rows at this density cannot fit one A4 page — if this stops being
    // multi-page, pagination broke rather than the content shrinking.
    const pages = buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []
    expect(pages.length).toBeGreaterThan(1)
  })

  it('renders the degenerate run — no title, nothing ticked, empty sections', async () => {
    const empty: ChecklistPdfData = {
      ...data,
      title: null,
      templateName: null,
      templateVersion: null,
      gate: 'GO',
      gateDetail: '',
      sections: [{ title: 'Empty section', description: null, accounted: 0, items: [] }],
    }

    const buffer = await render(empty)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })
})
