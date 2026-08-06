'use server'

import { revalidatePath } from 'next/cache'

import { toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { CreateApiKeySchema } from '../schemas/api-keys.schema'
import { apiKeysService } from '../server/api-keys-service'

/**
 * Mutations catch and return the standard envelope; reads throw to the boundary.
 * This module previously had no error handling — see roles.actions.ts.
 */
export async function listApiKeys() {
  const ctx = await getRequestContext()
  return apiKeysService.listApiKeys(ctx)
}

export async function createApiKey(input: unknown) {
  try {
    const ctx = await getRequestContext()
    const data = CreateApiKeySchema.parse(input)
    const result = await apiKeysService.createApiKey(ctx, data)
    revalidatePath('/admin/api-keys')
    return { ok: true as const, message: 'API key created', data: result }
  } catch (error) {
    return toActionResult(error, { action: 'createApiKey' })
  }
}

export async function revokeApiKey(keyId: string) {
  try {
    const ctx = await getRequestContext()
    await apiKeysService.revokeApiKey(ctx, keyId)
    revalidatePath('/admin/api-keys')
    return { ok: true as const, message: 'API key revoked' }
  } catch (error) {
    return toActionResult(error, { action: 'revokeApiKey' })
  }
}
