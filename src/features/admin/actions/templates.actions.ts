'use server'

import { revalidatePath } from 'next/cache'

import { toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { CreateTemplateSchema, UpdateTemplateSchema } from '../schemas/templates.schema'
import { templatesService } from '../server/templates-service'

/**
 * Mutations catch and return the standard envelope; reads throw to the boundary.
 * This module previously had no error handling — see roles.actions.ts.
 */
export async function listTemplates() {
  const ctx = await getRequestContext()
  return templatesService.listTemplates(ctx)
}

export async function createTemplate(input: unknown) {
  try {
    const ctx = await getRequestContext()
    const data = CreateTemplateSchema.parse(input)
    const result = await templatesService.createTemplate(ctx, data)
    revalidatePath('/admin/templates')
    return { ok: true as const, message: 'Template created', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'createTemplate' })
  }
}

export async function updateTemplate(id: string, input: unknown) {
  try {
    const ctx = await getRequestContext()
    const data = UpdateTemplateSchema.parse(input)
    const result = await templatesService.updateTemplate(ctx, id, data)
    revalidatePath('/admin/templates')
    revalidatePath(`/admin/templates/${id}`)
    return { ok: true as const, message: 'Template updated', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'updateTemplate' })
  }
}

export async function deleteTemplate(id: string) {
  try {
    const ctx = await getRequestContext()
    await templatesService.deleteTemplate(ctx, id)
    revalidatePath('/admin/templates')
    return { ok: true as const, message: 'Template deleted' }
  } catch (error) {
    return toActionResult(error, { action: 'deleteTemplate' })
  }
}
