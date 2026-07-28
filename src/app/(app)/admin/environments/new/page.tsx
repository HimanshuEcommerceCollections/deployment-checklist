import { EnvironmentForm } from '@/features/admin/components/environment-form'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export const metadata = { title: 'New Environment' }

export default function NewEnvironmentPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/admin/environments">
          <Button variant="ghost">← Back</Button>
        </Link>
        <h1 className="text-3xl font-bold">Create Environment</h1>
      </div>

      <div className="max-w-lg rounded-lg border p-6">
        <EnvironmentForm />
      </div>
    </div>
  )
}
