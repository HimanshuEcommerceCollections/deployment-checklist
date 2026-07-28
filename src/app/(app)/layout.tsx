import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { AppShell } from '@/components/layout/app-shell'
import { UnauthenticatedError } from '@/domain/shared/errors'
import { db } from '@/lib/db/prisma'
import { visibleNavigation } from '@/config/navigation'
import { getRequestContext } from '@/server/context'
import { runWithRequestStore } from '@/server/als'

/**
 * Authenticated layout.
 *
 * Tier 2 of two-tier verification: resolves the request context (which validates
 * sessionEpoch and account status against the database) and enters the tenant
 * AsyncLocalStorage scope so every Prisma query below is automatically
 * organization-scoped.
 *
 * An UnauthenticatedError here means the session was revoked mid-navigation —
 * suspended account, password change, role change. Redirecting with the reason
 * lets the login page explain what happened rather than silently bouncing.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  let ctx
  try {
    ctx = await getRequestContext()
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      redirect(`/login?reason=${encodeURIComponent(error.reason)}`)
    }
    throw error
  }

  const settings = await runWithRequestStore(
    {
      organizationId: ctx.organizationId,
      actorId: ctx.actorId,
      requestId: ctx.requestId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    () =>
      db.setting.findUnique({
        where: { organizationId: ctx.organizationId },
        select: { companyName: true },
      }),
  )

  // Lucide components cannot cross the RSC boundary, so the icon travels as a
  // name and the client component resolves it.
  const sections = visibleNavigation(ctx).map((section) => ({
    label: section.label,
    items: section.items.map((item) => ({
      label: item.label,
      href: item.href,
      icon: item.icon.displayName ?? item.icon.name,
      matchPrefix: item.matchPrefix,
    })),
  }))

  return (
    <AppShell
      sections={sections}
      user={{ name: ctx.actorName, email: ctx.actorEmail }}
      companyName={settings?.companyName ?? 'Deployment Checklist'}
    >
      {children}
    </AppShell>
  )
}
