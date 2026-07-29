'use server'

import { revalidatePath } from 'next/cache'
import { getRequestContext } from '@/server/context'
import { adminProjectsService } from '../server/admin-projects-service'

export async function listAllProjects() {
  const ctx = await getRequestContext()
  return adminProjectsService.listAllProjects(ctx)
}

function toMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export async function createAdminProject(input: any) {
  try {
    const ctx = await getRequestContext()
    const result = await adminProjectsService.createProject(ctx, input)
    revalidatePath('/admin/projects')
    return { ok: true as const, message: 'Project created', data: result }
  } catch (error) {
    return { ok: false as const, message: toMessage(error, 'Could not create project') }
  }
}

export async function updateAdminProject(id: string, input: any) {
  try {
    const ctx = await getRequestContext()
    const result = await adminProjectsService.updateProject(ctx, id, input)
    revalidatePath('/admin/projects')
    return { ok: true as const, message: 'Project updated', data: result }
  } catch (error) {
    return { ok: false as const, message: toMessage(error, 'Could not update project') }
  }
}

export async function deleteAdminProject(id: string) {
  try {
    const ctx = await getRequestContext()
    await adminProjectsService.deleteProject(ctx, id)
    revalidatePath('/admin/projects')
    return { ok: true as const, message: 'Project deleted' }
  } catch (error) {
    return { ok: false as const, message: toMessage(error, 'Could not delete project') }
  }
}
