import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getOrganization } from '@/features/admin/actions/organization.actions'
import { OrganizationForm } from '@/features/admin/components/organization-form'

export const metadata = { title: 'Organization Settings' }

export default async function OrganizationPage() {
  const org = await getOrganization()

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
          <OrganizationForm organization={org} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Organization Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">Organization ID</span>
            <span className="font-mono text-sm">{org.id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Status</span>
            <span>{org.isActive ? 'Active' : 'Inactive'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Created</span>
            <span>{new Date(org.createdAt).toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
