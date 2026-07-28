'use server'

import { getRequestContext } from '@/server/context'
import { membersService } from '../server/members-service'
import { AddMemberSchema, UpdateMemberSchema } from '../schemas/members.schema'

export async function listProjectMembers(projectId: string) {
  const ctx = await getRequestContext()
  return membersService.listProjectMembers(ctx, projectId)
}

export async function addProjectMember(projectId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = AddMemberSchema.parse(input)
  const result = await membersService.addMember(ctx, projectId, data)
  return { ok: true, message: 'Member added', data: result }
}

export async function updateProjectMember(membershipId: string, input: unknown) {
  const ctx = await getRequestContext()
  const data = UpdateMemberSchema.parse(input)
  const result = await membersService.updateMember(ctx, membershipId, data)
  return { ok: true, message: 'Member updated', data: result }
}

export async function removeProjectMember(membershipId: string) {
  const ctx = await getRequestContext()
  await membersService.removeMember(ctx, membershipId)
  return { ok: true, message: 'Member removed' }
}
