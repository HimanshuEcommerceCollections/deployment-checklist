'use server'

import { revalidatePath } from 'next/cache'

import { getRequestContext } from '@/server/context'
import { templateVersionsService } from '../server/template-versions-service'
import {
  CreateSectionSchema,
  CreateItemSchema,
  UpdateSectionSchema,
  UpdateItemSchema,
} from '../schemas/template-versions.schema'

function fail(error: unknown, fallback: string) {
  return {
    ok: false as const,
    message: error instanceof Error && error.message ? error.message : fallback,
  }
}

export async function getTemplateVersion(templateId: string, versionId: string) {
  const ctx = await getRequestContext()
  return templateVersionsService.getVersion(ctx, templateId, versionId)
}

export async function publishTemplateVersion(templateId: string, versionId: string) {
  try {
    const ctx = await getRequestContext()
    const data = await templateVersionsService.publishVersion(ctx, templateId, versionId)
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Version published', data }
  } catch (error) {
    return fail(error, 'Could not publish version')
  }
}

export async function deprecateTemplateVersion(templateId: string, versionId: string) {
  try {
    const ctx = await getRequestContext()
    const data = await templateVersionsService.deprecateVersion(ctx, templateId, versionId)
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Version deprecated', data }
  } catch (error) {
    return fail(error, 'Could not deprecate version')
  }
}

export async function createTemplateSection(
  templateId: string,
  versionId: string,
  input: unknown,
) {
  try {
    const ctx = await getRequestContext()
    const parsed = CreateSectionSchema.parse(input)
    const data = await templateVersionsService.createSection(ctx, templateId, versionId, parsed)
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Section added', data }
  } catch (error) {
    return fail(error, 'Could not add section')
  }
}

export async function updateTemplateSection(
  templateId: string,
  versionId: string,
  sectionId: string,
  input: unknown,
) {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateSectionSchema.parse(input)
    const data = await templateVersionsService.updateSection(
      ctx,
      templateId,
      versionId,
      sectionId,
      parsed,
    )
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Section updated', data }
  } catch (error) {
    return fail(error, 'Could not update section')
  }
}

export async function deleteTemplateSection(
  templateId: string,
  versionId: string,
  sectionId: string,
) {
  try {
    const ctx = await getRequestContext()
    await templateVersionsService.deleteSection(ctx, templateId, versionId, sectionId)
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Section deleted' }
  } catch (error) {
    return fail(error, 'Could not delete section')
  }
}

export async function createTemplateItem(
  templateId: string,
  versionId: string,
  sectionId: string,
  input: unknown,
) {
  try {
    const ctx = await getRequestContext()
    const parsed = CreateItemSchema.parse(input)
    const data = await templateVersionsService.createItem(
      ctx,
      templateId,
      versionId,
      sectionId,
      parsed,
    )
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Item added', data }
  } catch (error) {
    return fail(error, 'Could not add item')
  }
}

export async function updateTemplateItem(
  templateId: string,
  versionId: string,
  sectionId: string,
  itemId: string,
  input: unknown,
) {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateItemSchema.parse(input)
    const data = await templateVersionsService.updateItem(
      ctx,
      templateId,
      versionId,
      sectionId,
      itemId,
      parsed,
    )
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Item updated', data }
  } catch (error) {
    return fail(error, 'Could not update item')
  }
}

export async function deleteTemplateItem(
  templateId: string,
  versionId: string,
  sectionId: string,
  itemId: string,
) {
  try {
    const ctx = await getRequestContext()
    await templateVersionsService.deleteItem(ctx, templateId, versionId, sectionId, itemId)
    revalidatePath(`/admin/templates/${templateId}`)
    return { ok: true as const, message: 'Item deleted' }
  } catch (error) {
    return fail(error, 'Could not delete item')
  }
}
