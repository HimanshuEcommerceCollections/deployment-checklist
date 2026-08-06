'use server'

import { revalidatePath } from 'next/cache'

import { toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { CreateRoleSchema, UpdateRoleSchema } from '../schemas/roles.schema'
import { rolesService } from '../server/roles-service'

/**
 * Mutations catch and return the standard envelope; reads throw and let the page's
 * error boundary answer.
 *
 * This module previously had no error handling at all — a Zod failure or a service
 * refusal ("is a system role and cannot be deleted") escaped the Server Action, and
 * with no boundary either, the whole page crashed to Next's default error screen.
 */
export async function listRoles() {
  const ctx = await getRequestContext()
  return rolesService.listRoles(ctx)
}

export async function createRole(input: unknown) {
  try {
    const ctx = await getRequestContext()
    const data = CreateRoleSchema.parse(input)
    const result = await rolesService.createRole(ctx, data)
    revalidatePath('/admin/roles')
    return { ok: true as const, message: 'Role created', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'createRole' })
  }
}

export async function updateRole(id: string, input: unknown) {
  try {
    const ctx = await getRequestContext()
    const data = UpdateRoleSchema.parse(input)
    const result = await rolesService.updateRole(ctx, id, data)
    revalidatePath('/admin/roles')
    revalidatePath(`/admin/roles/${id}`)
    return { ok: true as const, message: 'Role updated', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'updateRole' })
  }
}

export async function deleteRole(id: string) {
  try {
    const ctx = await getRequestContext()
    await rolesService.deleteRole(ctx, id)
    revalidatePath('/admin/roles')
    return { ok: true as const, message: 'Role deleted' }
  } catch (error) {
    return toActionResult(error, { action: 'deleteRole' })
  }
}
