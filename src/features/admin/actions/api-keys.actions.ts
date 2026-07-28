'use server'

import { getRequestContext } from '@/server/context'
import { apiKeysService } from '../server/api-keys-service'
import { CreateApiKeySchema } from '../schemas/api-keys.schema'

export async function listApiKeys() {
  const ctx = await getRequestContext()
  return apiKeysService.listApiKeys(ctx)
}

export async function createApiKey(input: unknown) {
  const ctx = await getRequestContext()
  const data = CreateApiKeySchema.parse(input)
  const result = await apiKeysService.createApiKey(ctx, data)
  return { ok: true, message: 'API key created', data: result }
}

export async function revokeApiKey(keyId: string) {
  const ctx = await getRequestContext()
  await apiKeysService.revokeApiKey(ctx, keyId)
  return { ok: true, message: 'API key revoked' }
}
