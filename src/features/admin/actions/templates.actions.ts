'use server'

import { getRequestContext } from '@/server/context'
import { CreateTemplateSchema, UpdateTemplateSchema } from '../schemas/templates.schema'
import { templatesService } from '../server/templates-service'

export async function listTemplates() {
  const ctx = await getRequestContext()
  return templatesService.listTemplates(ctx)
}

export async function createTemplate(input: unknown) {
  const ctx = await getRequestContext()
  const data = CreateTemplateSchema.parse(input)
  const result = await templatesService.createTemplate(ctx, data)
  return { ok: true, message: 'Template created', data: result }
}

export async function updateTemplate(id: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = UpdateTemplateSchema.parse(input)
  const result = await templatesService.updateTemplate(ctx, id, data)
  return { ok: true, message: 'Template updated', data: result }
}

export async function deleteTemplate(id: string) {
  const ctx = await getRequestContext()
  await templatesService.deleteTemplate(ctx, id)
  return { ok: true, message: 'Template deleted' }
}
