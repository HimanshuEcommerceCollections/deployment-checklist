import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getIntegration } from '@/features/admin/actions/integrations.actions'
import { IntegrationForm } from '@/features/admin/components/integration-form'

export const metadata = { title: 'Edit Integration' }

export default async function EditIntegrationPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const integration = await getIntegration(id)
  if (!integration) notFound()

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/integrations">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Edit Integration</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{integration.name}</CardTitle>
          <CardDescription>Update or remove this integration.</CardDescription>
        </CardHeader>
        <CardContent>
          <IntegrationForm
            initial={{
              id: integration.id,
              type: integration.type as 'slack' | 'github' | 'webhook',
              name: integration.name,
              config: (integration.config ?? {}) as Record<string, unknown>,
              enabled: integration.enabled,
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
