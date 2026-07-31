'use server'

import { revalidatePath } from 'next/cache'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { RestoreSchema } from '../schemas/trash.schema'
import { trashService } from '../server/trash-service'

/**
 * Restoring changes what several other pages list, so every affected route is
 * revalidated rather than only /admin/trash. Missing one presents as "the
 * restore did nothing" until the next hard navigation.
 */
const REVALIDATE: Record<string, string[]> = {
  project: ['/admin/trash', '/admin/projects', '/projects'],
  template: ['/admin/trash', '/admin/templates'],
  environment: ['/admin/trash', '/admin/environments'],
  user: ['/admin/trash', '/admin/users'],
}

export async function restoreFromTrash(raw: unknown): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    const { kind, id } = RestoreSchema.parse(raw)

    await trashService.restore(ctx, kind, id)

    for (const path of REVALIDATE[kind] ?? ['/admin/trash']) {
      revalidatePath(path)
    }

    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'restoreFromTrash' })
  }
}
