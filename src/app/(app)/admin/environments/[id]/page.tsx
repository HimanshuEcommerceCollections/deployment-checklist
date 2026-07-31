import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { DeleteEnvironmentButton } from '@/features/admin/components/delete-environment-button'
import { EnvironmentForm } from '@/features/admin/components/environment-form'
import { environmentsService } from '@/features/admin/server/environments-service'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { requirePermission } from '@/lib/authz/authorize'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Edit Environment' }

export default async function EditEnvironmentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.environment.manage)

  /// getEnvironment throws when the id belongs to another tenant or is deleted.
  /// A 404 is the right answer to both — confirming existence would leak it.
  const environment = await environmentsService.getEnvironment(ctx, id).catch(() => null)
  if (!environment) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/environments">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Edit Environment</h1>
      </div>

      <div className="max-w-lg rounded-lg border p-6">
        <EnvironmentForm environment={environment} />
      </div>

      <div className="max-w-lg rounded-lg border border-destructive/40 p-6">
        <h2 className="font-semibold">Delete this environment</h2>
        <p className="mt-1 mb-4 text-sm text-muted-foreground">
          It moves to the trash and can be restored. Environments still referenced by a deployment
          cannot be deleted.
        </p>
        <DeleteEnvironmentButton id={environment.id} name={environment.name} />
      </div>
    </div>
  )
}
