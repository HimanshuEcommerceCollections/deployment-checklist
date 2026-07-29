'use server'

import { revalidatePath } from 'next/cache'

import { getRequestContext } from '@/server/context'
import { organizationService } from '../server/organization-service'
import { UpdateOrganizationSchema } from '../schemas/organization.schema'

export async function getOrganization() {
  const ctx = await getRequestContext()
  return organizationService.getOrganization(ctx)
}

export async function updateOrganization(input: unknown) {
  try {
    const ctx = await getRequestContext()
    const parsed = UpdateOrganizationSchema.parse(input)
    const data = await organizationService.updateOrganization(ctx, parsed)
    revalidatePath('/admin/organization')
    return { ok: true as const, message: 'Organization updated', data }
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error && error.message ? error.message : 'Could not update organization',
    }
  }
}
