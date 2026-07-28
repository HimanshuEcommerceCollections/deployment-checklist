'use server'

import { getRequestContext } from '@/server/context'
import { projectsService } from '../server/projects-service'

export async function listUserProjects() {
  const ctx = await getRequestContext()
  return projectsService.listUserProjects(ctx)
}

export async function getUserProject(id: string) {
  const ctx = await getRequestContext()
  return projectsService.getProject(ctx, id)
}
