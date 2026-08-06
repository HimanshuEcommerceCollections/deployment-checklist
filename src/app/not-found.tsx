import Link from 'next/link'

/**
 * Root 404 — reached for URLs that match no route at all, where no layout (and no
 * session) can be assumed. The in-shell variant at (app)/not-found.tsx handles
 * notFound() from authenticated pages with the navigation still standing.
 */
export default function RootNotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="eyebrow">// 404</p>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        There’s nothing at this address.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Go to the start page
      </Link>
    </div>
  )
}
