import { getTemplateVersion, publishTemplateVersion } from '@/features/admin/actions/template-versions.actions'
import { getRequestContext } from '@/server/context'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { requirePermission } from '@/lib/authz/authorize'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { notFound } from 'next/navigation'

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

  let version: any
  try {
    version = await getTemplateVersion(params.id, params.versionId)
  } catch {
    notFound()
  }

  const statusColor = {
    DRAFT: 'bg-gray-100 text-gray-800',
    PUBLISHED: 'bg-green-100 text-green-800',
    DEPRECATED: 'bg-red-100 text-red-800',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/admin/templates/${params.id}`}>
            <Button variant="ghost">← Back</Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">Version {version.versionNumber}</h1>
            <Badge className={statusColor[version.status as keyof typeof statusColor]}>
              {version.status}
            </Badge>
          </div>
        </div>
        {version.status === 'DRAFT' && (
          <form
            action={async () => {
              'use server'
              await publishTemplateVersion(params.id, params.versionId)
            }}
          >
            <Button type="submit">Publish Version</Button>
          </form>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sections</CardTitle>
        </CardHeader>
        <CardContent>
          {version.sections && version.sections.length > 0 ? (
            <div className="space-y-4">
              {version.sections.map((section: any) => (
                <div key={section.id} className="rounded-lg border p-4">
                  <h3 className="font-semibold">{section.title}</h3>
                  {section.description && (
                    <p className="text-sm text-gray-600 mt-1">{section.description}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">Order: {section.order}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-600">No sections yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
