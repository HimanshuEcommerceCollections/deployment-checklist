import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Organization Settings' }

export default async function OrganizationPage() {
  const ctx = await getRequestContext()
  const org = await db.organization.findUnique({
    where: { id: ctx.organizationId },
  })

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Organization Settings</h1>
        <p className="text-gray-600 mt-2">Manage your organization profile and details</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organization Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form action="/api/admin/organization/update" method="POST" className="space-y-4">
            <div>
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={org?.name}
                required
                maxLength={200}
              />
            </div>

            <div>
              <Label htmlFor="website">Website</Label>
              <Input
                id="website"
                name="website"
                type="url"
                defaultValue={org?.website || ''}
                placeholder="https://example.com"
              />
            </div>

            <div>
              <Label htmlFor="industry">Industry</Label>
              <Input
                id="industry"
                name="industry"
                defaultValue={org?.industry || ''}
                placeholder="Technology"
              />
            </div>

            <Button type="submit">Save Changes</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">Organization ID</span>
            <span className="font-mono text-sm">{org?.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Created</span>
            <span>{org?.createdAt && new Date(org.createdAt).toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
