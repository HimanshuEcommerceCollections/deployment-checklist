import { getProfile } from '@/features/profile/actions/profile.actions'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const user = await getProfile()

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Account Settings</h1>
        <p className="text-gray-600 mt-2">Manage your account information and security settings</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>Update your name, email, and job title</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/api/profile/update" method="POST" className="space-y-4">
            <div>
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                name="name"
                defaultValue={user.name}
                required
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={user.email}
                required
                maxLength={255}
              />
            </div>

            <div>
              <Label htmlFor="jobTitle">Job Title</Label>
              <Input
                id="jobTitle"
                name="jobTitle"
                defaultValue={user.jobTitle || ''}
                maxLength={100}
                placeholder="Optional"
              />
            </div>

            <Button type="submit">Save Changes</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Update your password to keep your account secure</CardDescription>
        </CardHeader>
        <CardContent>
          <form action="/api/profile/password" method="POST" className="space-y-4">
            <div>
              <Label htmlFor="currentPassword">Current Password</Label>
              <Input
                id="currentPassword"
                name="currentPassword"
                type="password"
                required
              />
            </div>

            <div>
              <Label htmlFor="newPassword">New Password</Label>
              <Input
                id="newPassword"
                name="newPassword"
                type="password"
                required
                minLength={8}
              />
            </div>

            <div>
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                required
                minLength={8}
              />
            </div>

            <Button type="submit">Change Password</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-gray-600">Account created</span>
            <span>{new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">User ID</span>
            <span className="font-mono text-sm">{user.id}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
