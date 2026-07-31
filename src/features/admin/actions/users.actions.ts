'use server'

import { revalidatePath } from 'next/cache'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { InviteUserSchema, UpdateUserSchema } from '../schemas/users.schema'
import { usersService } from '../server/users-service'

/** Every write here changes what /admin/users lists. */
function revalidateUsers(userId?: string) {
  revalidatePath('/admin/users')
  if (userId) revalidatePath(`/admin/users/${userId}`)
}

export async function listUsers(): Promise<ActionResult<unknown[]>> {
  try {
    const ctx = await getRequestContext()
    const users = await usersService.listUsers(ctx)
    return ok(users)
  } catch (error) {
    return toActionResult(error, { action: 'listUsers' })
  }
}

export async function inviteUser(raw: unknown): Promise<ActionResult<{ invitationId: string }>> {
  try {
    const ctx = await getRequestContext()
    const input = InviteUserSchema.parse(raw)

    const result = await usersService.inviteUser(ctx, input)
    revalidateUsers()
    return ok({ invitationId: result.invitation.id })
  } catch (error) {
    return toActionResult(error, { action: 'inviteUser' })
  }
}

export async function updateUser(
  userId: string,
  raw: unknown,
): Promise<ActionResult<{ id: string; email: string }>> {
  try {
    const ctx = await getRequestContext()
    const input = UpdateUserSchema.parse(raw)

    const updated = await usersService.updateUser(ctx, userId, input)
    revalidateUsers(userId)
    return ok({ id: updated.id, email: updated.email })
  } catch (error) {
    return toActionResult(error, { action: 'updateUser' })
  }
}

export async function deleteUser(userId: string): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    await usersService.deleteUser(ctx, userId)
    revalidateUsers(userId)
    revalidatePath('/admin/trash')
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'deleteUser' })
  }
}

/**
 * Re-send a pending invitation. Rate limited to 3 per hour per invitation inside
 * the service, which surfaces here as a plain validation message.
 */
export async function resendInvitation(userId: string): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    await usersService.resendInvitation(ctx, userId)
    revalidateUsers(userId)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'resendInvitation' })
  }
}

/**
 * Withdraw a pending invitation. The placeholder account goes with it — an
 * orphaned INVITED row would make the user list lie about who has access.
 */
export async function revokeInvitation(userId: string): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    await usersService.revokeInvitation(ctx, userId)
    revalidateUsers(userId)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'revokeInvitation' })
  }
}
