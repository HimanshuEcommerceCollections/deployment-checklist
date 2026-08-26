import { getRequestContext } from '@/server/context'
import { environmentsService } from '@/features/admin/server/environments-service'
import { Button } from '@/components/ui/button'
import { EnvironmentsList } from '@/features/admin/components/environments-list'
import Link from 'next/link'

export const metadata = { title: 'Environments' }

export default async function EnvironmentsPage() {
  const ctx = await getRequestContext()
  const environments = await environmentsService.listEnvironments(ctx)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Environments</h1>
          <p className="text-muted-foreground">Manage deployment targets</p>
        </div>
        <Link href="/admin/environments/new">
          <Button>Add Environment</Button>
        </Link>
      </div>

      <EnvironmentsList environments={environments} />
    </div>
  )
}
