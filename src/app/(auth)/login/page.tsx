import type { Metadata } from 'next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from '@/features/auth/components/login-form'

export const metadata: Metadata = { title: 'Sign in' }

/** Explains why the user landed back here, when we know. */
const REASON_MESSAGES: Record<string, string> = {
  'session-revoked': 'Your session ended because your account or password changed. Please sign in again.',
  'user-inactive': 'Your account is not active. Contact an administrator.',
  'user-removed': 'Your account is no longer available.',
  'no-session': 'Please sign in to continue.',
  timeout: 'You were signed out after a period of inactivity.',
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string; reset?: string }>
}) {
  const params = await searchParams
  const reasonMessage = params.reason ? REASON_MESSAGES[params.reason] : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use the email address your invitation was sent to.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {params.reset === 'success' && (
          <div
            role="status"
            className="border-go/40 bg-go-surface text-go rounded-lg border px-3 py-2.5 text-sm"
          >
            Your password has been changed. Sign in with your new password.
          </div>
        )}

        {reasonMessage && (
          <div
            role="status"
            className="border-hold/40 bg-hold-surface text-hold rounded-lg border px-3 py-2.5 text-sm"
          >
            {reasonMessage}
          </div>
        )}

        <LoginForm next={params.next} />
      </CardContent>
    </Card>
  )
}
