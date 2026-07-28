'use server'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { CreateEnvironmentSchema, UpdateEnvironmentSchema } from '../schemas/environments.schema'
import { environmentsService } from '../server/environments-service'

export async function listEnvironments(): Promise<ActionResult<unknown[]>> {
  try {
    const ctx = await getRequestContext()
    const envs = await environmentsService.listEnvironments(ctx)
    return ok(envs)
  } catch (error) {
    return toActionResult(error, { action: 'listEnvironments' })
  }
}

export async function createEnvironment(raw: unknown): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const ctx = await getRequestContext()
    const input = CreateEnvironmentSchema.parse(raw)
    const env = await environmentsService.createEnvironment(ctx, input)
    return ok({ id: env.id, name: env.name })
  } catch (error) {
    return toActionResult(error, { action: 'createEnvironment' })
  }
}

export async function updateEnvironment(
  id: string,
  raw: unknown,
): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const ctx = await getRequestContext()
    const input = UpdateEnvironmentSchema.parse(raw)
    const env = await environmentsService.updateEnvironment(ctx, id, input)
    return ok({ id: env.id, name: env.name })
  } catch (error) {
    return toActionResult(error, { action: 'updateEnvironment' })
  }
}

export async function deleteEnvironment(id: string): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    await environmentsService.deleteEnvironment(ctx, id)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'deleteEnvironment' })
  }
}
