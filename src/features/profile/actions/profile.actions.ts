'use server'

import { getRequestContext } from '@/server/context'
import { profileService } from '../server/profile-service'
import { UpdateProfileSchema, ChangePasswordSchema } from '../schemas/profile.schema'

export async function getProfile() {
  const ctx = await getRequestContext()
  return profileService.getProfile(ctx)
}

export async function updateProfile(input: unknown) {
  const ctx = await getRequestContext()
  const data = UpdateProfileSchema.parse(input)
  const result = await profileService.updateProfile(ctx, data)
  return { ok: true, message: 'Profile updated', data: result }
}

export async function changePassword(input: unknown) {
  const ctx = await getRequestContext()
  const data = ChangePasswordSchema.parse(input)
  const result = await profileService.changePassword(ctx, data)
  return { ok: true, message: 'Password changed', data: result }
}
