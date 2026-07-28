import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Security Settings' }

export default function SecurityPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Security Settings</h1>
        <p className="text-gray-600 mt-2">Manage authentication and security policies</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Two-Factor Authentication</CardTitle>
          <CardDescription>Require 2FA for all users</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-3">
            <input type="checkbox" name="require2fa" defaultChecked={false} />
            <span>Enforce 2FA for all organization members</span>
          </label>
          <Button>Configure 2FA Methods</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Single Sign-On (SSO)</CardTitle>
          <CardDescription>Connect to your identity provider</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="sso-provider">Provider</Label>
            <select
              id="sso-provider"
              className="w-full px-3 py-2 border rounded-md"
              defaultValue="none"
            >
              <option value="none">Disabled</option>
              <option value="oidc">OpenID Connect</option>
              <option value="saml">SAML 2.0</option>
              <option value="google">Google Workspace</option>
            </select>
          </div>
          <Button>Configure SSO</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Session Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Session Timeout (minutes)</Label>
            <input type="number" defaultValue="60" className="w-full px-3 py-2 border rounded-md" />
          </div>
          <Button type="submit">Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>IP Whitelist</CardTitle>
          <CardDescription>Restrict access to specific IP addresses</CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            className="w-full px-3 py-2 border rounded-md"
            placeholder="192.168.1.1&#10;10.0.0.0/8"
            rows={4}
          />
          <Button className="mt-4">Update Whitelist</Button>
        </CardContent>
      </Card>
    </div>
  )
}
