import type { Metadata } from 'next'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { can } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

export const metadata: Metadata = { title: 'Dashboard' }

/**
 * Dashboard — Phase 1 placeholder.
 *
 * Deliberately does not fake the stat tiles. Total Projects, Deployments Today,
 * Completion Rate and the activity feeds arrive in Phase 6, once there is real
 * data from Phase 4 to aggregate. Rendering zeroes styled as real metrics would
 * make an unfinished page look finished.
 *
 * What it does prove: the whole identity stack is wired — session verified
 * against the database, permissions resolved, navigation generated from them.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>
}) {
  const [ctx, params] = await Promise.all([getRequestContext(), searchParams])

  const abilities = {
    canCreateDeployment: can(ctx, PERMISSIONS.deployment.create),
    canManageTemplates: can(ctx, PERMISSIONS.template.manage),
    canInvite: can(ctx, PERMISSIONS.user.invite),
    isAdmin: can(ctx, PERMISSIONS.admin.access),
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {params.welcome === '1' && (
        <div
          role="status"
          className="border-go/40 bg-go-surface text-go rounded-lg border px-4 py-3 text-sm"
        >
          <p className="font-medium">Your account is ready</p>
          <p className="mt-0.5 opacity-90">
            You are signed in. Everything below reflects what your roles allow.
          </p>
        </div>
      )}

      <header>
        <p className="eyebrow mb-2">// Release Control</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          Welcome back, {ctx.actorName.split(' ')[0]}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Signed in as <span className="font-mono">{ctx.actorEmail}</span>
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your access</CardTitle>
          <CardDescription>
            Resolved from your roles on every request — not cached in your session token.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-muted-foreground mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
              Roles
            </p>
            <div className="flex flex-wrap gap-1.5">
              {ctx.roleKeys.length === 0 ? (
                <span className="text-muted-foreground text-sm">No roles assigned</span>
              ) : (
                ctx.roleKeys.map((role) => (
                  <Badge key={role} variant="secondary" className="font-mono text-xs">
                    {role}
                  </Badge>
                ))
              )}
              {ctx.permissions.isSuperAdmin && (
                <Badge className="bg-blocked-surface text-blocked border-blocked/40 border font-mono text-xs">
                  super-admin
                </Badge>
              )}
            </div>
          </div>

          <div>
            <p className="text-muted-foreground mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
              Permissions granted
            </p>
            <p className="text-sm">
              {ctx.permissions.isSuperAdmin
                ? 'All permissions (wildcard grant)'
                : `${ctx.permissions.global.size} organisation-wide, across ${ctx.permissions.byProject.size} project-scoped grant(s)`}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Next steps</CardTitle>
          <CardDescription>
            Phase 1 (identity) is complete. Projects, templates and the deployment console follow.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ol className="space-y-2 text-sm">
            {[
              { done: true, label: 'Sign in, invitations, password reset, audit trail' },
              { done: false, label: 'Projects and environments (Phase 2)' },
              { done: false, label: 'Checklist templates with versioning (Phase 3)' },
              { done: false, label: 'The deployment console (Phase 4)' },
            ].map((step) => (
              <li key={step.label} className="flex items-start gap-2.5">
                <span
                  className={
                    step.done
                      ? 'border-go bg-go text-background mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold'
                      : 'border-line mt-0.5 size-4 shrink-0 rounded-sm border'
                  }
                  aria-hidden
                >
                  {step.done ? '✓' : ''}
                </span>
                <span className={step.done ? 'text-muted-foreground line-through' : ''}>
                  {step.label}
                </span>
              </li>
            ))}
          </ol>

          {abilities.isAdmin && (
            <div className="border-line flex flex-wrap gap-2 border-t pt-3">
              {abilities.canInvite && (
                <Button size="sm" variant="outline" asChild>
                  <Link href="/admin/users">Invite a teammate</Link>
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link href="/admin/audit">View the audit log</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
