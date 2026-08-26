import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Usage & Analytics' }

/**
 * Every number on this page is a real query. The first version shipped with a
 * hardcoded "1,240 API calls", a storage card that measured nothing, and a trend
 * chart drawn from Math.random() — confident-looking analytics that lied on
 * every render. There is no API-call or storage metering in the system, so those
 * tiles are gone rather than faked.
 */
export default async function UsagePage() {
  const ctx = await getRequestContext()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [deploymentCount, userCount, projectCount, recentRuns] = await Promise.all([
    db.deploymentRun.count({
      where: { project: { organizationId: ctx.organizationId }, deletedAt: null },
    }),
    db.user.count({
      where: { organizationId: ctx.organizationId, status: 'ACTIVE' },
    }),
    db.project.count({
      where: { organizationId: ctx.organizationId, deletedAt: null },
    }),
    db.deploymentRun.findMany({
      where: {
        project: { organizationId: ctx.organizationId },
        deletedAt: null,
        createdAt: { gte: thirtyDaysAgo },
      },
      select: { createdAt: true },
    }),
  ])

  // Bucket the last 30 days, oldest first, today last.
  const days: { label: string; count: number }[] = []
  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
    days.push({ label: day.toISOString().slice(0, 10), count: 0 })
  }
  const byDay = new Map(days.map((d) => [d.label, d]))
  for (const run of recentRuns) {
    const bucket = byDay.get(run.createdAt.toISOString().slice(0, 10))
    if (bucket) bucket.count += 1
  }
  const peak = Math.max(1, ...days.map((d) => d.count))

  const stats = [
    { label: 'Total deployments', value: deploymentCount },
    { label: 'Active users', value: userCount },
    { label: 'Projects', value: projectCount },
    { label: 'Runs created (30d)', value: recentRuns.length },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Usage & Analytics</h1>
        <p className="text-muted-foreground mt-2">Monitor your organization&apos;s activity</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="tabular text-3xl font-bold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deployments created (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {recentRuns.length === 0 ? (
            <p className="text-muted-foreground py-10 text-center text-sm">
              No deployments were created in the last 30 days.
            </p>
          ) : (
            <div className="flex h-64 items-end justify-around gap-1">
              {days.map((day) => (
                <div
                  key={day.label}
                  className="bg-cyan/70 min-h-[2px] flex-1 rounded-t"
                  style={{ height: `${(day.count / peak) * 100}%` }}
                  title={`${day.label}: ${day.count}`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
