'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import type { ChecklistPdfData } from './checklist-pdf-document'

/**
 * Generates the checklist PDF in the browser and downloads it.
 *
 * This replaced `window.print()`. Printing pushed the dark console through a
 * print stylesheet and left the layout to whichever browser was asked; this
 * builds the artefact from the run's data with @react-pdf/renderer, so every
 * download of APEX-49 looks the same regardless of who exported it.
 *
 * Both the renderer (~1.5 MB) and the document definition load through dynamic
 * import inside the click handler — first press pays the fetch, the page bundle
 * never does.
 */
export function ChecklistPdfButton({ data }: { data: ChecklistPdfData }) {
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const [{ pdf }, { ChecklistPdfDocument }] = await Promise.all([
        import('@react-pdf/renderer'),
        import('./checklist-pdf-document'),
      ])

      const blob = await pdf(<ChecklistPdfDocument data={data} />).toBlob()

      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${data.reference}-checklist.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      // Chunk fetch offline, or a layout bug in the document — either way the
      // person pressed a button and deserves more than silence.
      console.error(error)
      toast.error('Could not generate the PDF. Try again, and tell an administrator if it persists.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" onClick={download} disabled={busy}>
      {busy ? 'Preparing PDF…' : 'Save PDF'}
    </Button>
  )
}
