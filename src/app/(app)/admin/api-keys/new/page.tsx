import { createApiKey } from '@/features/admin/actions/api-keys.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export const metadata = { title: 'Create API Key' }

export default function NewApiKeyPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/api-keys">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Create API Key</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New API Key</CardTitle>
          <CardDescription>
            Create a new API key for integrations and automation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createApiKey as any} method="POST" className="space-y-4">
            <div>
              <Label htmlFor="name">Key Name</Label>
              <Input
                id="name"
                name="name"
                placeholder="e.g., GitHub Actions, Slack Bot"
                required
                maxLength={100}
              />
            </div>

            <div>
              <Label htmlFor="expiresInDays">Expires In (days)</Label>
              <Input
                id="expiresInDays"
                name="expiresInDays"
                type="number"
                placeholder="Leave empty for no expiration"
                min="1"
              />
            </div>

            <fieldset className="space-y-3">
              <Label>Scopes</Label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="scopes" value="read:deployments" />
                  <span className="text-sm">Read Deployments</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="scopes" value="write:deployments" />
                  <span className="text-sm">Write Deployments</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="scopes" value="read:templates" />
                  <span className="text-sm">Read Templates</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="scopes" value="read:projects" />
                  <span className="text-sm">Read Projects</span>
                </label>
              </div>
            </fieldset>

            <Button type="submit">Create Key</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
