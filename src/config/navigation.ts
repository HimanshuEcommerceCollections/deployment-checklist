import {
  ClipboardListIcon,
  FolderKanbanIcon,
  GaugeIcon,
  HistoryIcon,
  KeyRoundIcon,
  ListChecksIcon,
  type LucideIcon,
  ScrollTextIcon,
  ServerIcon,
  SettingsIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react'

import { type RequestContext, can } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'

/**
 * Navigation is GENERATED from permissions, not hand-maintained.
 *
 * A QA user must never see a "Settings" link that 403s when clicked. Deriving
 * the menu from the same permission catalog the services enforce means the two
 * cannot drift — add a permission, and the nav follows.
 */
export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  /** Omit for items everyone signed in may see. */
  permission?: string
  /** Matches child routes too, so /projects/apex highlights "Projects". */
  matchPrefix?: boolean
}

export interface NavSection {
  label?: string
  items: NavItem[]
}

const MAIN: NavSection = {
  items: [
    { label: 'Dashboard', href: '/dashboard', icon: GaugeIcon },
    {
      label: 'Deployments',
      href: '/deployments',
      icon: HistoryIcon,
      permission: PERMISSIONS.deployment.read,
      matchPrefix: true,
    },
    {
      label: 'Projects',
      href: '/projects',
      icon: FolderKanbanIcon,
      permission: PERMISSIONS.project.read,
      matchPrefix: true,
    },
  ],
}

const ADMIN: NavSection = {
  label: 'Administration',
  items: [
    /// "Manage Projects", not "Projects" — the sidebar already has a Projects
    /// entry above, and two identically-labelled links reading differently by
    /// section is a coin toss for whoever is clicking.
    { label: 'Manage Projects', href: '/admin/projects', icon: FolderKanbanIcon, permission: PERMISSIONS.project.edit, matchPrefix: true },
    { label: 'Templates', href: '/admin/templates', icon: ClipboardListIcon, permission: PERMISSIONS.template.read, matchPrefix: true },
    { label: 'Environments', href: '/admin/environments', icon: ServerIcon, permission: PERMISSIONS.environment.manage },
    { label: 'Users', href: '/admin/users', icon: UsersIcon, permission: PERMISSIONS.user.read, matchPrefix: true },
    { label: 'Roles', href: '/admin/roles', icon: KeyRoundIcon, permission: PERMISSIONS.role.read, matchPrefix: true },
    { label: 'Audit log', href: '/admin/audit', icon: ScrollTextIcon, permission: PERMISSIONS.audit.read },
    { label: 'Trash', href: '/admin/trash', icon: Trash2Icon, permission: PERMISSIONS.project.restore },
    { label: 'Settings', href: '/admin/settings', icon: SettingsIcon, permission: PERMISSIONS.settings.read, matchPrefix: true },
  ],
}

/** Sections the actor may actually use. Empty sections are dropped entirely. */
export function visibleNavigation(ctx: RequestContext): NavSection[] {
  const sections: NavSection[] = []

  const main = MAIN.items.filter((item) => !item.permission || can(ctx, item.permission))
  if (main.length > 0) sections.push({ items: main })

  // One gate for the whole admin tree, matching the (admin) layout guard.
  if (can(ctx, PERMISSIONS.admin.access)) {
    const admin = ADMIN.items.filter((item) => !item.permission || can(ctx, item.permission))
    if (admin.length > 0) sections.push({ label: ADMIN.label, items: admin })
  }

  return sections
}

export { ListChecksIcon as BrandIcon }
