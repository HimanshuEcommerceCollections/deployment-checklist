'use server'

import { revalidatePath } from 'next/cache'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { AddMemberSchema, UpdateMemberSchema } from '../schemas/members.schema'
import { membersService } from '../server/members-service'

/**
 * A membership change alters what the affected user can see, not just this page.
 *
 * Permissions resolve per request from Membership, so the change is live on their
 * next navigation — but the assigning admin's own cached routes still need
 * clearing, and `/projects` is the list whose contents just changed for someone.
 */
function revalidateAccess(projectId: string, userId?: string) {
  revalidatePath(`/projects/${projectId}/members`)
  revalidatePath('/projects')
  revalidatePath('/admin/projects')
  if (userId) revalidatePath(`/admin/users/${userId}`)
}

export async function listProjectMembers(projectId: string) {
  const ctx = await getRequestContext()
  return membersService.listProjectMembers(ctx, projectId)
}

export async function addProjectMember(
  projectId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    const parsed = AddMemberSchema.parse(input)
    await membersService.addMember(ctx, projectId, parsed)
    revalidateAccess(projectId, parsed.userId)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'addProjectMember' })
  }
}

export async function updateProjectMember(
  projectId: string,
  userId: string,
  input: unknown,
): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateMemberSchema.parse(input)
    await membersService.updateMemberRoles(ctx, projectId, userId, parsed)
    revalidateAccess(projectId, userId)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'updateProjectMember' })
  }
}

export async function removeProjectMember(
  projectId: string,
  userId: string,
): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    await membersService.removeMember(ctx, projectId, userId)
    revalidateAccess(projectId, userId)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'removeProjectMember' })
  }
}
