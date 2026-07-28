'use server'

import { requireAuth } from '@/lib/authz/authorize'
import { CreateRoleSchema, UpdateRoleSchema } from '../schemas/roles.schema'
import { rolesService } from '../server/roles-service'

export async function listRoles() {
  const ctx = await requireAuth()
  return rolesService.listRoles(ctx)
}

export async function createRole(input: unknown) {
  const ctx = await requireAuth()
  const data = CreateRoleSchema.parse(input)
  const result = await rolesService.createRole(ctx, data)
  return { ok: true, message: 'Role created', data: result }
}

export async function updateRole(id: string, input: unknown) {
  const ctx = await requireAuth()
  const data = UpdateRoleSchema.parse(input)
  const result = await rolesService.updateRole(ctx, id, data)
  return { ok: true, message: 'Role updated', data: result }
}

export async function deleteRole(id: string) {
  const ctx = await requireAuth()
  await rolesService.deleteRole(ctx, id)
  return { ok: true, message: 'Role deleted' }
}
