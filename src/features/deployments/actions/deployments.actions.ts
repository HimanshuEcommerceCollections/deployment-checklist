'use server'

import { revalidatePath } from 'next/cache'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import {
  CreateDeploymentSchema,
  UpdateDeploymentItemSchema,
  CreateCommentSchema,
  TransitionDeploymentSchema,
  ListProjectDeploymentsSchema,
  ChecklistSectionInputSchema,
  UpdateChecklistSectionSchema,
  ChecklistItemInputSchema,
  UpdateChecklistItemSchema,
} from '../schemas/deployments.schema'
import { deploymentsService } from '../server/deployments-service'

export async function listProjectDeployments(projectId: string, query?: unknown) {
  const ctx = await getRequestContext()
  // URL search params, so parse defensively — the schema strips and defaults
  // rather than throwing, and a mangled param renders page 1 instead of a 500.
  return deploymentsService.listProjectDeployments(
    ctx,
    projectId,
    ListProjectDeploymentsSchema.parse(query ?? {}),
  )
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

/** Both renderings of the tailored run — the checklist and the overview. */
function revalidateChecklist(projectId: string, deploymentId: string) {
  revalidatePath(`/projects/${projectId}/deployments/${deploymentId}/checklist`)
  revalidatePath(`/projects/${projectId}/deployments/${deploymentId}`)
  revalidatePath(`/projects/${projectId}/deployments`)
}

export async function addChecklistSection(
  deploymentId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = ChecklistSectionInputSchema.parse(input)
    const result = await deploymentsService.addChecklistSection(ctx, deploymentId, parsed)
    revalidateChecklist(result.projectId, deploymentId)
    return ok({ id: result.id })
  } catch (error) {
    return toActionResult(error, { action: 'addChecklistSection' })
  }
}

export async function updateChecklistSection(
  deploymentId: string,
  sectionId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateChecklistSectionSchema.parse(input)
    const result = await deploymentsService.updateChecklistSection(
      ctx,
      deploymentId,
      sectionId,
      parsed,
    )
    revalidateChecklist(result.projectId, deploymentId)
    return ok({ id: result.id })
  } catch (error) {
    return toActionResult(error, { action: 'updateChecklistSection' })
  }
}

export async function removeChecklistSection(
  deploymentId: string,
  sectionId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const result = await deploymentsService.removeChecklistSection(ctx, deploymentId, sectionId)
    revalidateChecklist(result.projectId, deploymentId)
    return ok({ id: result.id })
  } catch (error) {
    return toActionResult(error, { action: 'removeChecklistSection' })
  }
}

export async function addChecklistItem(
  deploymentId: string,
  sectionId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = ChecklistItemInputSchema.parse(input)
    const result = await deploymentsService.addChecklistItem(ctx, deploymentId, sectionId, parsed)
    revalidateChecklist(result.projectId, deploymentId)
    return ok({ id: result.id })
  } catch (error) {
    return toActionResult(error, { action: 'addChecklistItem' })
  }
}

export async function updateChecklistItem(
  deploymentId: string,
  itemId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateChecklistItemSchema.parse(input)
    const result = await deploymentsService.updateChecklistItem(ctx, deploymentId, itemId, parsed)
    revalidateChecklist(result.projectId, deploymentId)
    return ok({ id: result.id })
  } catch (error) {
    return toActionResult(error, { action: 'updateChecklistItem' })
  }
}

export async function removeChecklistItem(
  deploymentId: string,
  itemId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const ctx = await getRequestContext()
    const result = await deploymentsService.removeChecklistItem(ctx, deploymentId, itemId)
    revalidateChecklist(result.projectId, deploymentId)
    return ok({ id: result.id })
  } catch (error) {
    return toActionResult(error, { action: 'removeChecklistItem' })
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
