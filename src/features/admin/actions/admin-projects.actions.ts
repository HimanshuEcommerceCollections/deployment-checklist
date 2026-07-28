'use server'

import { getRequestContext } from '@/server/context'
import { adminProjectsService } from '../server/admin-projects-service'

export async function listAllProjects() {
  const ctx = await getRequestContext()
  return adminProjectsService.listAllProjects(ctx)
}

export async function createAdminProject(input: any) {
  const ctx = await getRequestContext()
  const result = await adminProjectsService.createProject(ctx, input)
  return { ok: true, message: 'Project created', data: result }
}

export async function updateAdminProject(id: string, input: any) {
  const ctx = await getRequestContext()
  const result = await adminProjectsService.updateProject(ctx, id, input)
  return { ok: true, message: 'Project updated', data: result }
}

export async function deleteAdminProject(id: string) {
  const ctx = await getRequestContext()
  await adminProjectsService.deleteProject(ctx, id)
  return { ok: true, message: 'Project deleted' }
}
