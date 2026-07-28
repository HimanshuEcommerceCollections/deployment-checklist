import 'server-only'

import { NotFoundError } from '@/domain/shared/errors'
import { AUDIT_ACTIONS } from '@/lib/audit/actions'
import { audit } from '@/lib/audit/audit-service'
import { type RequestContext } from '@/lib/authz/authorize'
import { db } from '@/lib/db/prisma'

import type { UpdateSettingsInput } from '../schemas/settings.schema'

export class SettingsService {
  async getSettings(organizationId: string) {
    const settings = await db.setting.findUnique({
      where: { organizationId },
    })

    if (!settings) {
      throw new NotFoundError('Settings', organizationId)
    }

    return settings
  }

  async updateSettings(ctx: RequestContext, input: UpdateSettingsInput) {
    // Check permission — typically org-wide admin or super-admin
    const hasPermission =
      ctx.permissions.isSuperAdmin ||
      (await this.canManageSettings(ctx.actorId, ctx.organizationId))

    if (!hasPermission) {
      throw new Error('Insufficient permissions to manage settings')
    }

    const updated = await db.setting.update({
      where: { organizationId: ctx.organizationId },
      data: {
        companyName: input.companyName,
        supportEmail: input.supportEmail || null,
        primaryColor: input.primaryColor,
        defaultTheme: input.defaultTheme,
        sessionTimeoutMinutes: input.sessionTimeoutMinutes,
        sessionAbsoluteHours: input.sessionAbsoluteHours,
        inviteExpiryHours: input.inviteExpiryHours,
        passwordMinLength: input.passwordMinLength,
        passwordRequireMixed: input.passwordRequireMixed,
        maxFailedLogins: input.maxFailedLogins,
        lockoutMinutes: input.lockoutMinutes,
        emailDailyCap: input.emailDailyCap,
        emailRetryLimit: input.emailRetryLimit,
        maxUploadMb: input.maxUploadMb,
      },
    })

    await audit.record(db, ctx, AUDIT_ACTIONS.settings.updated, {
      entityType: 'Setting',
      entityId: updated.id,
      summary: `${ctx.actorName} updated organization settings`,
    })

    return updated
  }
}

export const settingsService = new SettingsService()
