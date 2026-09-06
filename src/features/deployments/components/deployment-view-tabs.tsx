import Link from 'next/link'

/**
 * The run's two faces — Overview (status, reasons, comments) and Checklist
 * (the tickable list). One entity, two views: they sit under a breadcrumb that
 * ends at the run reference, rather than pretending to be hierarchy levels.
 */
export function DeploymentViewTabs({
  projectId,
  deploymentId,
  active,
}: {
  projectId: string
  deploymentId: string
  active: 'overview' | 'checklist'
}) {
  const base = `/projects/${projectId}/deployments/${deploymentId}`
  const tabs = [
    { key: 'overview', label: 'Overview', href: base },
    { key: 'checklist', label: 'Checklist', href: `${base}/checklist` },
  ] as const

  return (
    <nav
      aria-label="Deployment views"
      className="no-print border-line bg-panel-2 inline-flex gap-1 rounded-lg border p-1"
    >
      {tabs.map((tab) =>
        tab.key === active ? (
          <span
            key={tab.key}
            aria-current="page"
            className="bg-panel text-foreground rounded-md px-3 py-1 text-sm font-medium shadow-sm"
          >
            {tab.label}
          </span>
        ) : (
          <Link
            key={tab.key}
            href={tab.href}
            className="text-muted-foreground hover:text-foreground rounded-md px-3 py-1 text-sm transition-colors"
          >
            {tab.label}
          </Link>
        ),
      )}
    </nav>
  )
}
