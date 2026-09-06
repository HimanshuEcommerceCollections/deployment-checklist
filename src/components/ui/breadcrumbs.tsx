import Link from 'next/link'

export interface Crumb {
  label: string
  /** Omit on the current page — it renders as text, not a link. */
  href?: string
}

/**
 * Ancestor trail for nested pages (project → deployments → run → checklist).
 *
 * Every level is one click away regardless of how the page was reached — a
 * back *button* can only encode one journey, and a run's checklist is reached
 * from the deployments list, the run overview, the dashboard and shared links.
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="no-print">
      <ol className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
        {items.map((item, index) => {
          const last = index === items.length - 1
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden className="text-muted-foreground/50">
                  /
                </span>
              )}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="hover:text-foreground transition-colors hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  className={last ? 'text-foreground font-medium' : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
