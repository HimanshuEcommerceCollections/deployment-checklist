import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getProfile } from '@/features/profile/actions/profile.actions'
import { PasswordForm } from '@/features/profile/components/password-form'
import { ProfileForm } from '@/features/profile/components/profile-form'

export const metadata = { title: 'Profile' }

export default async function ProfilePage() {
  const user = await getProfile()

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Account Settings</h1>
        <p className="mt-2 text-muted-foreground">
          Manage your account information and security settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Profile Information</CardTitle>
          <CardDescription>Update your name, email, and job title</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm name={user.name} email={user.email} jobTitle={user.jobTitle} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>Update your password to keep your account secure</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Account created</span>
            <span>{new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">User ID</span>
            <span className="font-mono text-sm">{user.id}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
