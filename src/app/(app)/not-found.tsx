import Link from 'next/link'

import { Button } from '@/components/ui/button'

/**
 * Renders for every `notFound()` inside the shell — which, by design, includes
 * things that exist but the viewer may not see. Object-level denials answer 404
 * rather than 403 so an id can never be confirmed by probing (docs/12), which is
 * why the copy below deliberately offers "or you don't have access" as a cause:
 * it is the truth, without saying which.
 */
export default function AppNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 text-center">
      <p className="eyebrow">// 404</p>
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="text-sm text-muted-foreground">
        This page doesn’t exist, was deleted, or you don’t have access to it. If someone sent
        you this link, ask them to check you’ve been given access to the project it belongs to.
      </p>
      <Link href="/dashboard">
        <Button>Go to dashboard</Button>
      </Link>
    </div>
  )
}
