import { TemplateForm } from '@/features/admin/components/template-form'
import { listTemplates } from '@/features/admin/actions/templates.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { notFound } from 'next/navigation'

export const metadata = { title: 'Edit Template' }

export default async function EditTemplatePage({ params }: { params: { id: string } }) {
  const templates = await listTemplates()
  const template = templates.find((t) => t.id === params.id)

  if (!template) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/templates">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Edit Template</h1>
      </div>

      <div className="max-w-2xl rounded-lg border p-6">
        <TemplateForm template={template} />
      </div>
    </div>
  )
}
