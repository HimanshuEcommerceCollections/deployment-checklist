'use server'

import { revalidatePath } from 'next/cache'

import { getRequestContext } from '@/server/context'
import {
  CreateDeploymentSchema,
  UpdateDeploymentItemSchema,
  CreateCommentSchema,
} from '../schemas/deployments.schema'
import { deploymentsService } from '../server/deployments-service'

function fail(error: unknown, fallback: string) {
  return {
    ok: false as const,
    message: error instanceof Error && error.message ? error.message : fallback,
  }
}

export async function listProjectDeployments(projectId: string) {
  const ctx = await getRequestContext()
  return deploymentsService.listProjectDeployments(ctx, projectId)
}

export async function getDeployment(id: string) {
  const ctx = await getRequestContext()
  return deploymentsService.getDeployment(ctx, id)
}

export async function createDeployment(input: unknown) {
  try {
    const ctx = await getRequestContext()
    const parsed = CreateDeploymentSchema.parse(input)
    const data = await deploymentsService.createDeployment(ctx, parsed)
    revalidatePath(`/projects/${parsed.projectId}/deployments`)
    return { ok: true as const, message: 'Deployment created', data }
  } catch (error) {
    return fail(error, 'Could not create deployment')
  }
}

export async function updateDeploymentItem(
  deploymentId: string,
  itemId: string,
  input: unknown,
) {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateDeploymentItemSchema.parse(input)
    const data = await deploymentsService.updateDeploymentItem(ctx, deploymentId, itemId, parsed)
    return { ok: true as const, data }
  } catch (error) {
    return fail(error, 'Could not update item')
  }
}

export async function addDeploymentComment(deploymentId: string, input: unknown) {
  try {
    const ctx = await getRequestContext()
    const parsed = CreateCommentSchema.parse(input)
    const data = await deploymentsService.addComment(ctx, deploymentId, parsed)
    return { ok: true as const, data }
  } catch (error) {
    return fail(error, 'Could not add comment')
  }
}
