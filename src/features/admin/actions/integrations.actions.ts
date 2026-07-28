'use server'

import { getRequestContext } from '@/server/context'
import { integrationsService } from '../server/integrations-service'
import { CreateIntegrationSchema, UpdateIntegrationSchema } from '../schemas/integrations.schema'

export async function listIntegrations() {
  const ctx = await getRequestContext()
  return integrationsService.listIntegrations(ctx)
}

export async function createIntegration(input: unknown) {
  const ctx = await getRequestContext()
  const data = CreateIntegrationSchema.parse(input)
  const result = await integrationsService.createIntegration(ctx, data)
  return { ok: true, message: 'Integration created', data: result }
}

export async function updateIntegration(id: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = UpdateIntegrationSchema.parse(input)
  const result = await integrationsService.updateIntegration(ctx, id, data)
  return { ok: true, message: 'Integration updated', data: result }
}

export async function deleteIntegration(id: string) {
  const ctx = await getRequestContext()
  await integrationsService.deleteIntegration(ctx, id)
  return { ok: true, message: 'Integration deleted' }
}
