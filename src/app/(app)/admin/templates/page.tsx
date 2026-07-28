import { TemplatesList } from '@/features/admin/components/templates-list'
import { listTemplates } from '@/features/admin/actions/templates.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'Templates' }

export default async function TemplatesPage() {
  const templates = await listTemplates()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Checklist Templates</h1>
        <Link href="/admin/templates/new">
          <Button>Create Template</Button>
        </Link>
      </div>

      <TemplatesList templates={templates} />
    </div>
  )
}
