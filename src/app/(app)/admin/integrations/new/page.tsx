import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { IntegrationForm } from '@/features/admin/components/integration-form'

export const metadata = { title: 'Add Integration' }

export default function NewIntegrationPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/integrations">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Add Integration</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New Integration</CardTitle>
          <CardDescription>Send deployment events to Slack, GitHub, or a webhook.</CardDescription>
        </CardHeader>
        <CardContent>
          <IntegrationForm />
        </CardContent>
      </Card>
    </div>
  )
}
