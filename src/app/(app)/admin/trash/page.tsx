import { TrashList, type TrashRow } from '@/features/admin/components/trash-list'
import { trashService } from '@/features/admin/server/trash-service'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Admin - Trash' }

export default async function TrashPage() {
  const ctx = await getRequestContext()

  /// Permission and tenant scoping live in the service — the route only renders.
  const entries = await trashService.listTrash(ctx)

  const rows: TrashRow[] = entries.map((entry) => ({
    ...entry,
    deletedAt: entry.deletedAt.toISOString(),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Trash</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Soft-deleted records, newest first. Nothing here is gone — restoring returns it with its
          history intact.
        </p>
      </div>

      <TrashList entries={rows} />
    </div>
  )
}
