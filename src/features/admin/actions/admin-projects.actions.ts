'use server'

import { revalidatePath } from 'next/cache'
import { toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'
import { adminProjectsService } from '../server/admin-projects-service'

export async function listAllProjects() {
  const ctx = await getRequestContext()
  return adminProjectsService.listAllProjects(ctx)
}

export async function getAdminProject(id: string) {
  const ctx = await getRequestContext()
  return adminProjectsService.getProject(ctx, id)
}

export async function createAdminProject(input: any) {
  try {
    const ctx = await getRequestContext()
    const result = await adminProjectsService.createProject(ctx, input)
    revalidatePath('/admin/projects')
    return { ok: true as const, message: 'Project created', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'createAdminProject' })
  }
}

export async function updateAdminProject(id: string, input: any) {
  try {
    const ctx = await getRequestContext()
    const result = await adminProjectsService.updateProject(ctx, id, input)
    revalidatePath('/admin/projects')
    return { ok: true as const, message: 'Project updated', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'updateAdminProject' })
  }
}

export async function deleteAdminProject(id: string) {
  try {
    const ctx = await getRequestContext()
    await adminProjectsService.deleteProject(ctx, id)
    revalidatePath('/admin/projects')
    return { ok: true as const, message: 'Project deleted' }
  } catch (error) {
    return toActionResult(error, { action: 'deleteAdminProject' })
  }
}
