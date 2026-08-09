'use server'

import { getRequestContext } from '@/server/context'

import { searchService, type SearchHit } from '../server/search-service'

export async function search(query: string): Promise<SearchHit[]> {
  const ctx = await getRequestContext()
  return searchService.search(ctx, query)
}
