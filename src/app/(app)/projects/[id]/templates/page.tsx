import { getRequestContext } from '@/server/context'
import { projectFilter } from '@/lib/authz/authorize'
import { PERMISSIONS } from '@/lib/authz/permissions'
import { db } from '@/lib/db/prisma'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { notFound } from 'next/navigation'

export const metadata = { title: 'Project Templates' }

export default async function ProjectTemplatesPage(props: {
  params: Promise<{ id: string }>
}) {
  const params = await props.params
  const ctx = await getRequestContext()

  try {
    // Existence check only — the id in the URL must resolve to a project this
    // actor may read. `AND` keeps the scope from overwriting the `id` above.
    await db.project.findFirstOrThrow({
      where: {
        id: params.id,
        organizationId: ctx.organizationId,
        deletedAt: null,
        AND: [projectFilter(ctx, PERMISSIONS.project.read, 'id')],
      },
      select: { id: true },
    })
  } catch {
    notFound()
  }

  const templates = await db.checklistTemplate.findMany({
    where: { organizationId: ctx.organizationId, deletedAt: null },
    include: { _count: { select: { versions: true } } },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={`/projects/${params.id}`}>
            <Button variant="ghost">← Back</Button>
          </Link>
          <h1 className="text-3xl font-bold">Project Templates</h1>
        </div>
      </div>

      <p className="text-gray-600">
        Select which templates are available for creating deployments in this project.
      </p>

      {templates.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-gray-600">No templates available.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((template: any) => (
            <label
              key={template.id}
              className="p-4 rounded-lg border border-gray-200 hover:border-blue-400 cursor-pointer transition"
            >
              <input
                type="checkbox"
                name="templates"
                value={template.id}
                className="w-4 h-4"
              />
              <div className="ml-3 inline-block">
                <p className="font-medium">{template.name}</p>
                <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {template._count.versions} version(s)
                </p>
              </div>
            </label>
          ))}
        </div>
      )}

      <Button type="submit">Save Templates</Button>
    </div>
  )
}
