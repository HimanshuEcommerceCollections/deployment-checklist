'use client'

import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function SearchPage() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [searched, setSearched] = useState(false)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return

    setSearched(true)
    // Mock results - in production would call a search API
    setResults([
      {
        id: '1',
        type: 'deployment',
        title: 'API v2.0 Release',
        description: 'Production deployment to main cluster',
        path: '/projects/1/deployments/1',
      },
      {
        id: '2',
        type: 'project',
        title: 'Backend Services',
        description: 'Core API services and microservices',
        path: '/projects/1',
      },
    ])
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">Search</h1>
        <p className="text-gray-600 mt-2">Find deployments, projects, and templates</p>
      </div>

      <form onSubmit={handleSearch} className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="Search deployments, projects, templates..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
          <Button type="submit">Search</Button>
        </div>
      </form>

      {searched && results.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-600">No results found for "{query}"</p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((result) => (
            <Link key={result.id} href={result.path}>
              <Card className="hover:shadow-lg transition-shadow cursor-pointer">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{result.title}</h3>
                      <p className="text-sm text-gray-600 mt-1">{result.description}</p>
                      <span className="text-xs text-gray-500 mt-2 inline-block capitalize">
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
