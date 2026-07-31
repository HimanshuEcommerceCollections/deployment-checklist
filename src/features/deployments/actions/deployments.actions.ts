'use server'

import { revalidatePath } from 'next/cache'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import {
  CreateDeploymentSchema,
  UpdateDeploymentItemSchema,
  CreateCommentSchema,
  TransitionDeploymentSchema,
} from '../schemas/deployments.schema'
import { deploymentsService } from '../server/deployments-service'

export async function listProjectDeployments(projectId: string) {
  const ctx = await getRequestContext()
  return deploymentsService.listProjectDeployments(ctx, projectId)
}

export async function getDeployment(id: string) {
  const ctx = await getRequestContext()
  return deploymentsService.getDeployment(ctx, id)
}

export async function createDeployment(input: unknown): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = CreateDeploymentSchema.parse(input)
    const created = await deploymentsService.createDeployment(ctx, parsed)
    revalidatePath(`/projects/${parsed.projectId}/deployments`)
    return ok({ id: created.id })
  } catch (error) {
    return toActionResult(error, { action: 'createDeployment' })
  }
}

export async function updateDeploymentItem(
  deploymentId: string,
  itemId: string,
  input: unknown,
): Promise<ActionResult<{ revision: number }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateDeploymentItemSchema.parse(input)
    const item = await deploymentsService.updateDeploymentItem(ctx, deploymentId, itemId, parsed)
    return ok({ revision: item.revision })
  } catch (error) {
    return toActionResult(error, { action: 'updateDeploymentItem' })
  }
}

/**
 * Every status change goes through here.
 *
 * The standard envelope matters more than usual for this one: a refused
 * completion carries `details` describing how many items are outstanding, and the
 * console renders that instead of a bare "not allowed".
 */
export async function transitionDeployment(
  deploymentId: string,
  input: unknown,
): Promise<ActionResult<{ status: string }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = TransitionDeploymentSchema.parse(input)
    const run = await deploymentsService.transition(ctx, deploymentId, parsed.transition, {
      reason: parsed.reason,
    })

    // Both renderings of a run, plus the two lists that show its status.
    revalidatePath(`/projects/${run.projectId}/deployments/${run.id}`)
    revalidatePath(`/projects/${run.projectId}/deployments/${run.id}/checklist`)
    revalidatePath(`/projects/${run.projectId}/deployments`)
    revalidatePath('/deployments')

    return ok({ status: run.status })
  } catch (error) {
    return toActionResult(error, { action: 'transitionDeployment' })
  }
}

export async function addDeploymentComment(
  deploymentId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = CreateCommentSchema.parse(input)
    const comment = await deploymentsService.addComment(ctx, deploymentId, parsed)
    revalidatePath(`/projects/${comment.projectId}/deployments/${comment.deploymentId}`)
    return ok({ id: comment.id })
  } catch (error) {
    return toActionResult(error, { action: 'addDeploymentComment' })
  }
}
