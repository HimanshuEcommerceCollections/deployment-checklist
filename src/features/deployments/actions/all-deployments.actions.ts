'use server'

import { getRequestContext } from '@/server/context'
import { allDeploymentsService } from '../server/all-deployments-service'

export async function listAllUserDeployments() {
  const ctx = await getRequestContext()
  return allDeploymentsService.listUserDeployments(ctx)
}
