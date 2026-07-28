'use server'

import { getRequestContext } from '@/server/context'
import { templateVersionsService } from '../server/template-versions-service'
import { CreateSectionSchema, CreateItemSchema, UpdateSectionSchema, UpdateItemSchema } from '../schemas/template-versions.schema'

export async function getTemplateVersion(templateId: string, versionId: string) {
  const ctx = await getRequestContext()
  return templateVersionsService.getVersion(ctx, templateId, versionId)
}

export async function publishTemplateVersion(templateId: string, versionId: string) {
  const ctx = await getRequestContext()
  const result = await templateVersionsService.publishVersion(ctx, templateId, versionId)
  return { ok: true, message: 'Version published', data: result }
}

export async function deprecateTemplateVersion(templateId: string, versionId: string) {
  const ctx = await getRequestContext()
  const result = await templateVersionsService.deprecateVersion(ctx, templateId, versionId)
  return { ok: true, message: 'Version deprecated', data: result }
}

export async function createTemplateSection(templateId: string, versionId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = CreateSectionSchema.parse(input)
  const result = await templateVersionsService.createSection(ctx, templateId, versionId, data)
  return { ok: true, data: result }
}

export async function updateTemplateSection(sectionId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = UpdateSectionSchema.parse(input)
  const result = await templateVersionsService.updateSection(ctx, sectionId, data)
  return { ok: true, data: result }
}

export async function deleteTemplateSection(sectionId: string) {
  const ctx = await getRequestContext()
  await templateVersionsService.deleteSection(ctx, sectionId)
  return { ok: true, message: 'Section deleted' }
}

export async function createTemplateItem(sectionId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = CreateItemSchema.parse(input)
  const result = await templateVersionsService.createItem(ctx, sectionId, data)
  return { ok: true, data: result }
}

export async function updateTemplateItem(itemId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = UpdateItemSchema.parse(input)
  const result = await templateVersionsService.updateItem(ctx, itemId, data)
  return { ok: true, data: result }
}

export async function deleteTemplateItem(itemId: string) {
  const ctx = await getRequestContext()
  await templateVersionsService.deleteItem(ctx, itemId)
  return { ok: true, message: 'Item deleted' }
}
