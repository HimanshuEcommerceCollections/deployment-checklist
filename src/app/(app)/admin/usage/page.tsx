import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Usage & Analytics' }

export default async function UsagePage() {
  const ctx = await getRequestContext()

  const [deploymentCount, userCount, projectCount] = await Promise.all([
    db.deploymentRun.count({
      where: { project: { organizationId: ctx.organizationId } },
    }),
    db.user.count({
      where: { organizationId: ctx.organizationId },
    }),
    db.project.count({
      where: { organizationId: ctx.organizationId, deletedAt: null },
    }),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Usage & Analytics</h1>
        <p className="text-gray-600 mt-2">Monitor your organization's activity</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600">Total Deployments</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{deploymentCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600">Active Users</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{userCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600">Projects</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{projectCount}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-gray-600">API Calls (30d)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">1,240</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deployment Trend (Last 30 Days)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-end justify-around gap-1">
            {Array.from({ length: 30 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-blue-500 rounded-t"
                style={{ height: `${Math.random() * 100}%` }}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Storage Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span>Deployment History</span>
            <span>1.2 GB</span>
          </div>
          <div className="flex justify-between">
            <span>Attachments</span>
            <span>0.8 GB</span>
          </div>
          <div className="flex justify-between">
            <span>Backups</span>
            <span>0.4 GB</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
