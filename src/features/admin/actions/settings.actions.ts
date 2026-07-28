'use server'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { UpdateSettingsSchema } from '../schemas/settings.schema'
import { settingsService } from '../server/settings-service'

export async function updateSettings(raw: unknown): Promise<ActionResult<{ companyName: string }>> {
  try {
    const ctx = await getRequestContext()
    const input = UpdateSettingsSchema.parse(raw)

    const updated = await settingsService.updateSettings(ctx, input)

    return ok({ companyName: updated.companyName })
  } catch (error) {
    return toActionResult(error, { action: 'updateSettings' })
  }
}
