import { SettingsForm } from '@/features/admin/components/settings-form'
import { requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Organization Settings' }

export default async function SettingsPage() {
  const ctx = await getRequestContext()
  requirePermission(ctx, PERMISSIONS.settings.read)

  /**
   * Exactly the fields the form edits — never the whole row. `findUniqueOrThrow`
   * with no `select` shipped every Setting column into the RSC payload, including
   * the sealed SMTP and API-key secret refs, and until the admin layout existed
   * this page had no guard at all.
   */
  const settings = await db.setting.findUniqueOrThrow({
    where: { organizationId: ctx.organizationId },
    select: {
      companyName: true,
      supportEmail: true,
      primaryColor: true,
      defaultTheme: true,
      sessionTimeoutMinutes: true,
      sessionAbsoluteHours: true,
      inviteExpiryHours: true,
      passwordMinLength: true,
      passwordRequireMixed: true,
      maxFailedLogins: true,
      lockoutMinutes: true,
      emailDailyCap: true,
      emailRetryLimit: true,
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Organization Settings</h1>
        <p className="text-muted-foreground">Manage your organization's configuration</p>
      </div>

      <SettingsForm settings={settings} />
    </div>
  )
}
