'use server'

import { getRequestContext } from '@/server/context'
import { CreateDeploymentSchema, UpdateDeploymentItemSchema, CreateCommentSchema } from '../schemas/deployments.schema'
import { deploymentsService } from '../server/deployments-service'

export async function listProjectDeployments(projectId: string) {
  const ctx = await getRequestContext()
  return deploymentsService.listProjectDeployments(ctx, projectId)
}

export async function getDeployment(id: string) {
  const ctx = await getRequestContext()
  return deploymentsService.getDeployment(ctx, id)
}

export async function createDeployment(input: unknown) {
  const ctx = await getRequestContext()
  const data = CreateDeploymentSchema.parse(input)
  const result = await deploymentsService.createDeployment(ctx, data)
  return { ok: true, message: 'Deployment created', data: result }
}

export async function updateDeploymentItem(deploymentId: string, itemId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = UpdateDeploymentItemSchema.parse(input)
  const result = await deploymentsService.updateDeploymentItem(ctx, deploymentId, itemId, data)
  return { ok: true, data: result }
}

export async function addDeploymentComment(deploymentId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = CreateCommentSchema.parse(input)
  const result = await deploymentsService.addComment(ctx, deploymentId, data)
  return { ok: true, data: result }
}
