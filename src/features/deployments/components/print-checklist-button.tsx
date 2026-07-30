'use client'

import { Button } from '@/components/ui/button'

/**
 * Print / Save PDF.
 *
 * A client component purely so `window.print()` has a browser to talk to. The
 * checklist page is a Server Component, and an `onClick` on it throws "Event
 * handlers cannot be passed to Client Component props" during render — which took
 * the entire checklist page down with a 500, not just the button.
 *
 * Print-to-PDF is a behaviour carried over from the reference design: a signed
 * checklist is the artefact people file after a release.
 */
export function PrintChecklistButton() {
  return (
    <Button variant="outline" onClick={() => window.print()}>
      Print / Save PDF
    </Button>
  )
}
