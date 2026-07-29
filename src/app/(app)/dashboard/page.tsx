import type { Metadata } from 'next'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { listAllUserDeployments } from '@/features/deployments/actions/all-deployments.actions'
import { listUserProjects } from '@/features/projects/actions/projects.actions'
import { can } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

export const metadata: Metadata = { title: 'Dashboard' }

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-go-surface text-go border-go/40',
  IN_PROGRESS: 'bg-hold-surface text-hold border-hold/40',
  BLOCKED: 'bg-blocked-surface text-blocked border-blocked/40',
  FAILED: 'bg-blocked-surface text-blocked border-blocked/40',
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>
}) {
  const [ctx, params, projects, deployments] = await Promise.all([
    getRequestContext(),
    searchParams,
    listUserProjects(),
    listAllUserDeployments(),
  ])

  const active = deployments.filter((d) => d.status === 'IN_PROGRESS' || d.status === 'BLOCKED')
  const completed = deployments.filter((d) => d.status === 'COMPLETED')
  const recent = deployments.slice(0, 5)

  const isAdmin = can(ctx, PERMISSIONS.admin.access)
  const canInvite = can(ctx, PERMISSIONS.user.invite)

  const stats = [
    { label: 'Projects', value: projects.length, tone: '' },
    { label: 'In flight', value: active.length, tone: 'text-hold' },
    { label: 'Completed', value: completed.length, tone: 'text-go' },
  ]

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-6">
              <p className="text-muted-foreground font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
                {stat.label}
              </p>
              <p className={`mt-1 text-3xl font-semibold tabular-nums ${stat.tone}`}>
                {stat.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Recent deployments</CardTitle>
            <CardDescription>Across every project you are a member of.</CardDescription>
          </div>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/deployments">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No deployments yet. They appear here once a release run is created.
            </p>
          ) : (
            <ul className="divide-line divide-y">
              {recent.map((dep) => (
                <li key={dep.id}>
                  <Link
                    href={`/projects/${dep.projectId}/deployments/${dep.id}`}
                    className="hover:bg-panel-2 -mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-2.5 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        <span className="font-mono">{dep.reference}</span>
                        {dep.title ? ` · ${dep.title}` : ''}
                      </p>
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {dep.project.name} · {dep.environmentName} · v{dep.version}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={`shrink-0 border font-mono text-[10px] ${
                        STATUS_STYLES[dep.status] ?? ''
                      }`}
                    >
                      {dep.status.replace('_', ' ')}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Your projects</CardTitle>
            <CardDescription>
              Resolved from your roles on every request — not cached in your session token.
            </CardDescription>
          </div>
          <Button size="sm" variant="ghost" asChild>
            <Link href="/projects">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {projects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects assigned yet.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {projects.slice(0, 4).map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="border-line hover:bg-panel-2 rounded-lg border p-3 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: project.color }}
                      aria-hidden
                    />
                    <p className="truncate text-sm font-medium">{project.name}</p>
                  </div>
                  <p className="text-muted-foreground mt-1 font-mono text-xs">
                    {project.key} · {project._count.deployments} deployment
                    {project._count.deployments === 1 ? '' : 's'}
                  </p>
                </Link>
              ))}
            </div>
          )}

          <div>
            <p className="text-muted-foreground mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
              Your roles
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

          {isAdmin && (
            <div className="border-line flex flex-wrap gap-2 border-t pt-3">
              {canInvite && (
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
