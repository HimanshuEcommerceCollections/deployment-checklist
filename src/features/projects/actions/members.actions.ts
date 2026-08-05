'use server'

import { revalidatePath } from 'next/cache'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { AssignProjectSchema } from '../schemas/members.schema'
import { membersService } from '../server/members-service'

/**
 * An assignment changes what the affected user can see, not just this page.
 *
 * Permissions resolve per request from Membership, so it is live on their next
 * navigation — but the assigning admin's own cached routes still need clearing,
 * and /projects is the list whose contents just changed for someone.
 */
function revalidateAccess(projectId: string, userId: string) {
  revalidatePath(`/projects/${projectId}/members`)
  revalidatePath('/projects')
  revalidatePath('/admin/projects')
  revalidatePath(`/admin/users/${userId}`)
}

export async function listProjectMembers(projectId: string) {
  const ctx = await getRequestContext()
  return membersService.listProjectMembers(ctx, projectId)
}

export async function assignProject(
  projectId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    const { userId } = AssignProjectSchema.parse(input)
    await membersService.assignProject(ctx, projectId, userId)
    revalidateAccess(projectId, userId)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'assignProject' })
  }
}

export async function revokeProject(
  projectId: string,
  userId: string,
): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    await membersService.revokeProject(ctx, projectId, userId)
    revalidateAccess(projectId, userId)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'revokeProject' })
  }
}
