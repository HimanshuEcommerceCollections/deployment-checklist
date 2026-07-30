import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { TemplateForm } from '@/features/admin/components/template-form'
import { TemplateVersionsList } from '@/features/admin/components/template-versions-list'
import { templatesService } from '@/features/admin/server/templates-service'
import { can, requirePermission } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { getRequestContext } from '@/server/context'

export const metadata = { title: 'Edit Template' }

export default async function EditTemplatePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params
  const ctx = await getRequestContext()

  try {
    requirePermission(ctx, PERMISSIONS.template.read)
  } catch {
    notFound()
  }

  let template: Awaited<ReturnType<typeof templatesService.getTemplate>>
  try {
    template = await templatesService.getTemplate(ctx, params.id)
  } catch {
    notFound()
  }

  const versions = [...template.versions]
    .sort((a, b) => b.version - a.version)
    .map((version) => ({
      id: version.id,
      version: version.version,
      status: version.status,
      sectionCount: version.sectionCount,
      itemCount: version.itemCount,
      requiredCount: version.requiredCount,
      publishedAt: version.publishedAt,
      isCurrent: version.id === template.currentVersionId,
    }))

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/admin/templates">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">{template.name}</h1>
      </div>

      <div className="max-w-2xl rounded-lg border p-6">
        <TemplateForm template={template} />
      </div>

      <TemplateVersionsList
        templateId={template.id}
        versions={versions}
        canManage={can(ctx, PERMISSIONS.template.manage)}
      />
    </div>
  )
}
