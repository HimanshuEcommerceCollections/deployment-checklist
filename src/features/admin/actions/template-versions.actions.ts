'use server'

import { revalidatePath } from 'next/cache'

import { getRequestContext } from '@/server/context'
import { templateVersionsService } from '../server/template-versions-service'
import {
  CreateDraftVersionSchema,
  CreateSectionSchema,
  CreateItemSchema,
  ReorderSchema,
  UpdateSectionSchema,
  UpdateItemSchema,
} from '../schemas/template-versions.schema'

function fail(error: unknown, fallback: string) {
  return {
    ok: false as const,
    message: error instanceof Error && error.message ? error.message : fallback,
  }
}

/**
 * Every content mutation happens on the version editor page, so revalidating
 * only the template page (as this module originally did) left the editor showing
 * stale sections after every edit.
 */
function revalidateVersion(templateId: string, versionId: string) {
  revalidatePath(`/admin/templates/${templateId}`)
  revalidatePath(`/admin/templates/${templateId}/versions/${versionId}`)
}

export async function getTemplateVersion(templateId: string, versionId: string) {
  const ctx = await getRequestContext()
  return templateVersionsService.getVersion(ctx, templateId, versionId)
}

export async function publishTemplateVersion(templateId: string, versionId: string) {
  try {
    const ctx = await getRequestContext()
    const data = await templateVersionsService.publishVersion(ctx, templateId, versionId)
    revalidateVersion(templateId, versionId)
    return { ok: true as const, message: 'Version published', data }
  } catch (error) {
    return fail(error, 'Could not publish version')
  }
}

export async function deprecateTemplateVersion(templateId: string, versionId: string) {
  try {
    const ctx = await getRequestContext()
    const data = await templateVersionsService.deprecateVersion(ctx, templateId, versionId)
    revalidateVersion(templateId, versionId)
    return { ok: true as const, message: 'Version deprecated', data }
  } catch (error) {
    return fail(error, 'Could not deprecate version')
  }
}

export async function createDraftTemplateVersion(templateId: string, input: unknown = {}) {
  try {
    const ctx = await getRequestContext()
    const parsed = CreateDraftVersionSchema.parse(input)
    const data = await templateVersionsService.createDraftVersion(ctx, templateId, parsed)
    revalidateVersion(templateId, data.id)
    return { ok: true as const, message: `Draft v${data.version} created`, data }
  } catch (error) {
    return fail(error, 'Could not create a draft version')
  }
}

export async function reorderTemplateSections(
  templateId: string,
  versionId: string,
  input: unknown,
) {
  try {
    const ctx = await getRequestContext()
    const parsed = ReorderSchema.parse(input)
    const data = await templateVersionsService.reorderSections(ctx, templateId, versionId, parsed)
    revalidateVersion(templateId, versionId)
    return { ok: true as const, message: 'Sections reordered', data }
  } catch (error) {
    return fail(error, 'Could not reorder sections')
  }
}

export async function reorderTemplateItems(
  templateId: string,
  versionId: string,
  sectionId: string,
  input: unknown,
) {
  try {
    const ctx = await getRequestContext()
    const parsed = ReorderSchema.parse(input)
    const data = await templateVersionsService.reorderItems(
      ctx,
      templateId,
      versionId,
      sectionId,
      parsed,
    )
    revalidateVersion(templateId, versionId)
    return { ok: true as const, message: 'Items reordered', data }
  } catch (error) {
    return fail(error, 'Could not reorder items')
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
    revalidateVersion(templateId, versionId)
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
    revalidateVersion(templateId, versionId)
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
    revalidateVersion(templateId, versionId)
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
    revalidateVersion(templateId, versionId)
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
    revalidateVersion(templateId, versionId)
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
    revalidateVersion(templateId, versionId)
    return { ok: true as const, message: 'Item deleted' }
  } catch (error) {
    return fail(error, 'Could not delete item')
  }
}
