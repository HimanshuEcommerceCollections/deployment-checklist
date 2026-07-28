import type { Metadata } from 'next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SetPasswordForm } from '@/features/auth/components/set-password-form'
import { TokenStateCard } from '@/features/auth/components/token-state'
import { passwordService } from '@/features/auth/server/password-service'
import { DEFAULT_POLICY } from '@/lib/auth/password-policy'
import { db } from '@/lib/db/prisma'

export const metadata: Metadata = { title: 'Reset password' }

/** Token state must never be cached or prerendered — it changes on use. */
export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await passwordService.inspectResetToken(token)

  if (result.state !== 'valid') {
    return <TokenStateCard state={result.state} flow="reset" />
  }

  const settings = await db.setting.findUnique({
    where: { organizationId: result.token.user.organizationId },
    select: { passwordMinLength: true, passwordRequireMixed: true },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new password</CardTitle>
        <CardDescription>
          You will be signed out everywhere else once this is saved.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SetPasswordForm
          mode="reset"
          token={token}
          email={result.token.user.email}
          policy={{
            minLength: settings?.passwordMinLength ?? DEFAULT_POLICY.minLength,
            requireMixed: settings?.passwordRequireMixed ?? DEFAULT_POLICY.requireMixed,
          }}
        />
      </CardContent>
    </Card>
  )
}
