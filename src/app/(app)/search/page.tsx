'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { search } from '@/features/search/actions/search.actions'
import type { SearchHit } from '@/features/search/server/search-service'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchHit[]>([])
  const [searched, setSearched] = useState(false)
  const [pending, startTransition] = useTransition()

  const handleSearch = (event: React.FormEvent) => {
    event.preventDefault()
    const q = query.trim()
    if (!q) return

    startTransition(async () => {
      const hits = await search(q)
      setResults(hits)
      setSearched(true)
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Search</h1>
        <p className="mt-2 text-gray-600">Find deployments and projects you have access to.</p>
      </div>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search deployments and projects…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="flex-1"
          />
          <Button type="submit" disabled={pending}>
            {pending ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>

      {searched && !pending && results.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-gray-600">No results found for &ldquo;{query}&rdquo;.</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <Link key={`${result.type}-${result.id}`} href={result.path}>
              <Card className="cursor-pointer transition-shadow hover:shadow-lg">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{result.title}</h3>
                      <p className="mt-1 text-sm text-gray-600">{result.description}</p>
                      <span className="mt-2 inline-block text-xs capitalize text-gray-500">
                        {result.type}
                      </span>
                    </div>
                    <Button variant="ghost" size="sm">
                      View →
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
