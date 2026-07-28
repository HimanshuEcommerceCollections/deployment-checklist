'use server'

import { requireAuth } from '@/lib/authz/authorize'
import { projectsService } from '../server/projects-service'

export async function listUserProjects() {
  const ctx = await requireAuth()
  return projectsService.listUserProjects(ctx)
}

export async function getUserProject(id: string) {
  const ctx = await requireAuth()
  return projectsService.getProject(ctx, id)
}
