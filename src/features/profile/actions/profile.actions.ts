'use server'

import { revalidatePath } from 'next/cache'

import { type ActionResult, ok, toActionResult } from '@/lib/http/action-result'
import { getRequestContext } from '@/server/context'

import { ChangePasswordSchema, UpdateProfileSchema } from '../schemas/profile.schema'
import { profileService } from '../server/profile-service'

export async function getProfile() {
  const ctx = await getRequestContext()
  return profileService.getProfile(ctx)
}

/**
 * These returned a bare `{ ok: true }` and let everything else throw. An uncaught
 * throw in a Server Action reaches the client as an opaque digest, so "that email
 * address is already in use" and "your current password is incorrect" — both
 * raised deliberately by the service — arrived as an unexplained failure. They now
 * use the same envelope as every other action, which also carries Zod field errors
 * back to the form.
 */
export async function updateProfile(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    const data = UpdateProfileSchema.parse(input)
    await profileService.updateProfile(ctx, data)

    // The header and user menu render the name, so they must not keep the old one.
    revalidatePath('/', 'layout')
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'updateProfile' })
  }
}

export async function changePassword(input: unknown): Promise<ActionResult<undefined>> {
  try {
    const ctx = await getRequestContext()
    const data = ChangePasswordSchema.parse(input)
    await profileService.changePassword(ctx, data)
    return ok()
  } catch (error) {
    return toActionResult(error, { action: 'changePassword' })
  }
}
