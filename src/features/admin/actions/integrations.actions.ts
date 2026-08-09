'use server'

import { revalidatePath } from 'next/cache'

import { toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { CreateIntegrationSchema, UpdateIntegrationSchema } from '../schemas/integrations.schema'
import { integrationsService } from '../server/integrations-service'

/**
 * Mutations catch and return the standard envelope; reads throw to the boundary.
 * This module previously had no error handling — see roles.actions.ts.
 */
export async function listIntegrations() {
  const ctx = await getRequestContext()
  return integrationsService.listIntegrations(ctx)
}

export async function getIntegration(id: string) {
  const ctx = await getRequestContext()
  return integrationsService.getIntegration(ctx, id)
}

export async function createIntegration(input: unknown) {
  try {
    const ctx = await getRequestContext()
    const data = CreateIntegrationSchema.parse(input)
    const result = await integrationsService.createIntegration(ctx, data)
    revalidatePath('/admin/integrations')
    return { ok: true as const, message: 'Integration created', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'createIntegration' })
  }
}

export async function updateIntegration(id: string, input: unknown) {
  try {
    const ctx = await getRequestContext()
    const data = UpdateIntegrationSchema.parse(input)
    const result = await integrationsService.updateIntegration(ctx, id, data)
    revalidatePath('/admin/integrations')
    return { ok: true as const, message: 'Integration updated', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'updateIntegration' })
  }
}

export async function deleteIntegration(id: string) {
  try {
    const ctx = await getRequestContext()
    await integrationsService.deleteIntegration(ctx, id)
    revalidatePath('/admin/integrations')
    return { ok: true as const, message: 'Integration deleted' }
  } catch (error) {
    return toActionResult(error, { action: 'deleteIntegration' })
  }
}
