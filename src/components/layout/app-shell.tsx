import { MenuIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

import { SidebarNav, type SerializedNavSection } from '@/components/layout/sidebar-nav'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

/**
 * Authenticated shell. A Server Component — the only client islands are the nav
 * (active state), the theme toggle, and the user menu.
 */
export function AppShell({
  children,
  sections,
  user,
  companyName,
}: {
  children: ReactNode
  sections: SerializedNavSection[]
  user: { name: string; email: string }
  companyName: string
}) {
  return (
    <div className="flex min-h-svh flex-col">
      {/* Chrome is not part of the artefact — see the print block in globals.css. */}
      <header className="no-print bg-panel/80 border-line sticky top-0 z-40 border-b backdrop-blur-sm">
        <div className="flex h-14 items-center gap-3 px-4">
          {/* Mobile nav. Below md the sidebar collapses into this sheet. */}
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open navigation">
                <MenuIcon className="size-4" />
              </Button>
            </DialogTrigger>
            <DialogContent className="left-0 top-0 h-svh max-w-72 translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 p-6">
              <DialogTitle className="eyebrow mb-4">// {companyName}</DialogTitle>
              <SidebarNav sections={sections} />
            </DialogContent>
          </Dialog>

          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="eyebrow hidden sm:inline">// {companyName}</span>
            <span className="text-sm font-semibold sm:hidden">{companyName}</span>
          </Link>

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="no-print border-line hidden w-60 shrink-0 border-r px-3 py-6 md:block">
          <SidebarNav sections={sections} />
        </aside>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  )
}
