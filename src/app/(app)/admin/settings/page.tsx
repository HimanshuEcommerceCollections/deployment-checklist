import { getRequestContext } from '@/server/context'
import { db } from '@/lib/db/prisma'
import { SettingsForm } from '@/features/admin/components/settings-form'

export const metadata = { title: 'Organization Settings' }

export default async function SettingsPage() {
  const ctx = await getRequestContext()

  const settings = await db.setting.findUniqueOrThrow({
    where: { organizationId: ctx.organizationId },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Organization Settings</h1>
        <p className="text-gray-600">Manage your organization's configuration</p>
      </div>

      <SettingsForm settings={settings} />
    </div>
  )
}
