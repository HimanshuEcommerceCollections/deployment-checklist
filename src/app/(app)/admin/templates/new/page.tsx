import { TemplateForm } from '@/features/admin/components/template-form'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'New Template' }

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/templates">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Create Template</h1>
      </div>

      <div className="max-w-2xl rounded-lg border p-6">
        <TemplateForm />
      </div>
    </div>
  )
}
