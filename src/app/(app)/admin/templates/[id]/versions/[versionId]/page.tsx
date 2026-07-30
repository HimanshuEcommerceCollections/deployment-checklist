import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { TemplateVersionEditor } from '@/features/admin/components/template-version-editor'
import { environmentsService } from '@/features/admin/server/environments-service'
import { rolesService } from '@/features/admin/server/roles-service'
import { templateVersionsService } from '@/features/admin/server/template-versions-service'
import { can, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Template Version' }

export default async function TemplateVersionPage(props: {
  params: Promise<{ id: string; versionId: string }>
}) {
  const params = await props.params
  const ctx = await getRequestContext()

  try {
    requirePermission(ctx, PERMISSIONS.template.read)
  } catch {
    notFound()
  }

  // Services rather than the actions layer: this is already a server component
  // holding a context, and the actions return loosely-typed results built for
  // client callers.
  let version: Awaited<ReturnType<typeof templateVersionsService.getVersion>>
  try {
    version = await templateVersionsService.getVersion(ctx, params.id, params.versionId)
  } catch {
    notFound()
  }

  // Only needed to populate the item editor's choices, so a failure here must not
  // take the editor down with it.
  const [environments, roles] = await Promise.all([
    environmentsService.listEnvironments(ctx).catch(() => []),
    rolesService.listRoles(ctx).catch(() => []),
  ])

  return (
    <div className="space-y-6">
      <Link href={`/admin/templates/${params.id}`}>
        <Button variant="ghost">← Back to template</Button>
      </Link>

      <TemplateVersionEditor
        templateId={params.id}
        templateName={version.template.name}
        versionId={version.id}
        versionNumber={version.version}
        status={version.status}
        itemCount={version.itemCount}
        requiredCount={version.requiredCount}
        sections={version.sections.map((section) => ({
          id: section.id,
          key: section.key,
          title: section.title,
          description: section.description,
          order: section.order,
          items: section.items.map((item) => ({
            id: item.id,
            key: item.key,
            label: item.label,
            helpText: item.helpText,
            order: item.order,
            isRequired: item.isRequired,
            evidenceRequired: item.evidenceRequired,
            ownerRoleKey: item.ownerRoleKey,
            environmentKeys: item.environmentKeys,
          })),
        }))}
        environments={environments.map((environment) => ({
          key: environment.key,
          name: environment.name,
        }))}
        roles={roles.map((role) => ({ key: role.key, name: role.name }))}
        canManage={can(ctx, PERMISSIONS.template.manage)}
        canPublish={can(ctx, PERMISSIONS.template.publish)}
        canDeprecate={can(ctx, PERMISSIONS.template.deprecate)}
      />
    </div>
  )
}
