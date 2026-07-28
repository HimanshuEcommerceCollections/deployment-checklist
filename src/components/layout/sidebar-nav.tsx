'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

/**
 * Client component only because it needs `usePathname` for active state.
 * The nav DATA is resolved on the server from permissions and passed in, so no
 * permission logic reaches the browser.
 */
export interface SerializedNavItem {
  label: string
  href: string
  /** Icon resolved by name — Lucide components are not serializable across RSC. */
  icon: string
  matchPrefix?: boolean
}

export interface SerializedNavSection {
  label?: string
  items: SerializedNavItem[]
}

import * as icons from 'lucide-react'

function Icon({ name, className }: { name: string; className?: string }) {
  const Component = (icons as unknown as Record<string, icons.LucideIcon>)[name]
  if (!Component) return <icons.CircleIcon className={className} />
  return <Component className={className} />
}

export function SidebarNav({
  sections,
  onNavigate,
}: {
  sections: SerializedNavSection[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()

  const isActive = (item: SerializedNavItem) =>
    item.matchPrefix ? pathname === item.href || pathname.startsWith(`${item.href}/`) : pathname === item.href

  return (
    <nav className="flex flex-col gap-6" aria-label="Main">
      {sections.map((section, index) => (
        <div key={section.label ?? `section-${index}`} className="flex flex-col gap-1">
          {section.label && (
            <p className="text-muted-foreground mb-1 px-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em]">
              {section.label}
            </p>
          )}

          {section.items.map((item) => {
            const active = isActive(item)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                  active
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon name={item.icon} className="size-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
