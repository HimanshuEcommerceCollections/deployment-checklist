import { getRequestContext } from '@/server/context'
import { db } from '@/lib/db/prisma'
import { InviteUserForm } from '@/features/admin/components/invite-user-form'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Invite User' }

export default async function InviteUserPage() {
  const ctx = await getRequestContext()

  const roles = await db.role.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    select: { id: true, name: true, key: true },
    orderBy: { name: 'asc' },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/users">
          <Button variant="ghost">← Back</Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Invite User</h1>
        </div>
      </div>

      <div className="max-w-lg rounded-lg border p-6">
        <InviteUserForm roles={roles} />
      </div>
    </div>
  )
}
