import { Badge } from '@/components/ui/badge'
import type { DeploymentStatus } from '@/domain/deployments/lifecycle'

/**
 * One place that decides what a status looks like.
 *
 * Both renderings of a run showed the raw enum — "IN_PROGRESS", "ROLLED_BACK" —
 * which is fine until the seven statuses are actually reachable and people have
 * to read them at a glance during a release.
 */
const LABEL: Record<DeploymentStatus, string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  ROLLED_BACK: 'Rolled back',
}

const STYLE: Record<DeploymentStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  IN_PROGRESS: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  BLOCKED: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300',
  COMPLETED: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  CANCELLED: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  ROLLED_BACK: 'bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300',
}

export function DeploymentStatusBadge({
  status,
  className,
}: {
  status: string
  className?: string
}) {
  const known = status as DeploymentStatus

  return (
    <Badge className={`${STYLE[known] ?? STYLE.DRAFT} ${className ?? ''}`}>
      {LABEL[known] ?? status}
    </Badge>
  )
}

export function statusLabel(status: string): string {
  return LABEL[status as DeploymentStatus] ?? status
}
