'use server'

import { requireAuth } from '@/lib/authz/authorize'
import { adminProjectsService } from '../server/admin-projects-service'

export async function listAllProjects() {
  const ctx = await requireAuth()
  return adminProjectsService.listAllProjects(ctx)
}

export async function createAdminProject(input: any) {
  const ctx = await requireAuth()
  const result = await adminProjectsService.createProject(ctx, input)
  return { ok: true, message: 'Project created', data: result }
}

export async function updateAdminProject(id: string, input: any) {
  const ctx = await requireAuth()
  const result = await adminProjectsService.updateProject(ctx, id, input)
  return { ok: true, message: 'Project updated', data: result }
}

export async function deleteAdminProject(id: string) {
  const ctx = await requireAuth()
  await adminProjectsService.deleteProject(ctx, id)
  return { ok: true, message: 'Project deleted' }
}
