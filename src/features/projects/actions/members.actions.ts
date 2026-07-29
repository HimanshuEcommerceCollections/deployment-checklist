'use server'

import { revalidatePath } from 'next/cache'

import { getRequestContext } from '@/server/context'
import { membersService } from '../server/members-service'
import { AddMemberSchema, UpdateMemberSchema } from '../schemas/members.schema'

function fail(error: unknown, fallback: string) {
  return {
    ok: false as const,
    message: error instanceof Error && error.message ? error.message : fallback,
  }
}

export async function listProjectMembers(projectId: string) {
  const ctx = await getRequestContext()
  return membersService.listProjectMembers(ctx, projectId)
}

export async function addProjectMember(projectId: string, input: unknown) {
  try {
    const ctx = await getRequestContext()
    const parsed = AddMemberSchema.parse(input)
    const data = await membersService.addMember(ctx, projectId, parsed)
    revalidatePath(`/projects/${projectId}/members`)
    return { ok: true as const, message: 'Member added', data }
  } catch (error) {
    return fail(error, 'Could not add member')
  }
}

export async function updateProjectMember(projectId: string, userId: string, input: unknown) {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateMemberSchema.parse(input)
    const data = await membersService.updateMemberRoles(ctx, projectId, userId, parsed)
    revalidatePath(`/projects/${projectId}/members`)
    return { ok: true as const, message: 'Member updated', data }
  } catch (error) {
    return fail(error, 'Could not update member')
  }
}

export async function removeProjectMember(projectId: string, userId: string) {
  try {
    const ctx = await getRequestContext()
    await membersService.removeMember(ctx, projectId, userId)
    revalidatePath(`/projects/${projectId}/members`)
    return { ok: true as const, message: 'Member removed' }
  } catch (error) {
    return fail(error, 'Could not remove member')
  }
}
