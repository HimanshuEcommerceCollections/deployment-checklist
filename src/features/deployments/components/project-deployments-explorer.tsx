'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export interface DeploymentRow {
  id: string
  reference: string
  title: string | null
  version: string
  status: string
  environmentName: string | null
  completedItems: number
  totalItems: number
  /** ISO string — serialized on the server so the row shape stays plain. */
  createdAt: string
}

interface ProjectDeploymentsExplorerProps {
  projectId: string
  rows: DeploymentRow[]
  total: number
  page: number
  pageSize: number
  query: { q?: string; status?: string; from?: string; to?: string }
}

const PAGE_SIZES = [10, 20, 50, 100]

const STATUS_OPTIONS = [
  'DRAFT',
  'IN_PROGRESS',
  'BLOCKED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
] as const

const statusLabel = (status: string) =>
  status.charAt(0) + status.slice(1).toLowerCase().replace('_', ' ')

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-muted text-foreground',
  IN_PROGRESS: 'bg-cyan/10 text-cyan',
  BLOCKED: 'bg-hold-surface text-hold',
  COMPLETED: 'bg-go-surface text-go',
  FAILED: 'bg-blocked-surface text-blocked',
  CANCELLED: 'bg-muted text-muted-foreground',
  ROLLED_BACK: 'bg-blocked-surface text-blocked',
}

export function ProjectDeploymentsExplorer({
  projectId,
  rows,
  total,
  page,
  pageSize,
  query,
}: ProjectDeploymentsExplorerProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  /**
   * All list state lives in the URL: filters survive refresh, links are
   * shareable, and the server component re-queries on every change. A patch
   * that changes anything other than the page resets to page 1 — keeping the
   * old offset against a newly narrowed result set shows an empty page.
   */
  const setParams = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    if (!('page' in patch)) params.delete('page')
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  // Debounced search — typing edits local state, the URL follows 300ms later.
  const [search, setSearch] = useState(query.q ?? '')
  const appliedSearch = useRef(query.q ?? '')
  useEffect(() => {
    if (search === appliedSearch.current) return
    const handle = setTimeout(() => {
      appliedSearch.current = search
      setParams({ q: search || undefined })
    }, 300)
    return () => clearTimeout(handle)
  }, [search])

  const hasFilters = Boolean(query.q || query.status || query.from || query.to)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(page * pageSize, total)

  const openChecklist = (deploymentId: string) =>
    router.push(`/projects/${projectId}/deployments/${deploymentId}/checklist`)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Input
            type="search"
            placeholder="Search reference, title or version…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search deployments"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <select
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={query.status ?? ''}
            onChange={(event) => setParams({ status: event.target.value || undefined })}
          >
            <option value="">All</option>
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">From</span>
          <input
            type="date"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={query.from ?? ''}
            max={query.to || undefined}
            onChange={(event) => setParams({ from: event.target.value || undefined })}
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">To</span>
          <input
            type="date"
            className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            value={query.to ?? ''}
            min={query.from || undefined}
            onChange={(event) => setParams({ to: event.target.value || undefined })}
          />
        </label>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              appliedSearch.current = ''
              setParams({ q: undefined, status: undefined, from: undefined, to: undefined })
            }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground">
            {hasFilters
              ? 'No deployments match these filters.'
              : 'No deployments yet. Create one to get started.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Checked</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((dep) => (
                <TableRow
                  key={dep.id}
                  className="hover:bg-panel-2 cursor-pointer transition-colors"
                  tabIndex={0}
                  aria-label={`Open checklist for ${dep.title || dep.reference}`}
                  onClick={() => openChecklist(dep.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') openChecklist(dep.id)
                  }}
                >
                  <TableCell className="font-medium">
                    {dep.title || `${dep.reference} · ${dep.version}`}
                    <span className="text-muted-foreground block font-mono text-xs">
                      {dep.reference}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_STYLES[dep.status] ?? 'bg-muted text-foreground'}>
                      {dep.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{dep.environmentName}</TableCell>
                  <TableCell className="text-sm">
                    {dep.completedItems}/{dep.totalItems}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(dep.createdAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* The row opens the checklist; this reaches the overview
                        (status actions, comments) without swallowing the row click. */}
                    <Link
                      href={`/projects/${projectId}/deployments/${dep.id}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Button variant="ghost" size="sm">
                        View
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          {total === 0 ? 'No deployments' : `Showing ${rangeStart}–${rangeEnd} of ${total}`}
        </p>

        <div className="flex items-center gap-3">
          <label className="text-muted-foreground flex items-center gap-2">
            Per page
            <select
              className="border-input bg-background h-8 rounded-md border px-2 text-sm"
              value={String(pageSize)}
              onChange={(event) => setParams({ pageSize: event.target.value })}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setParams({ page: String(page - 1) })}
            >
              Previous
            </Button>
            <span className="text-muted-foreground px-2 tabular-nums">
              {page} / {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pageCount}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
