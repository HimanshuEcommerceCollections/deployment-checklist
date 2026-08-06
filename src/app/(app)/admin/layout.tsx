import type { ReactNode } from 'react'

import { requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

/**
 * One gate for the whole /admin tree.
 *
 * The navigation has always hidden the Administration section from anyone without
 * `admin.access`, and `visibleNavigation` even cited "the (admin) layout guard" as
 * its server-side counterpart — but no such layout existed. Hiding a link is not
 * access control: typing /admin/settings straight into the URL bar reached a page
 * that read the organization's entire Setting row for any signed-in account.
 *
 * The denial thrown here is rendered by `(app)/error.tsx` as a proper "you don't
 * have access" screen, with the shell still standing.
 *
 * Pages below this stay responsible for their own FINER permission — this gate
 * answers "may they enter administration at all", not "may they edit settings".
 * A Release Manager passes here (they own /admin/templates) and is still refused
 * user management by `user.read` in the service.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.admin.access)

  return children
}
