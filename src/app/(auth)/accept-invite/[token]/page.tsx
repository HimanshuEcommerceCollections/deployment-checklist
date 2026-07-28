import type { Metadata } from 'next'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SetPasswordForm } from '@/features/auth/components/set-password-form'
import { TokenStateCard } from '@/features/auth/components/token-state'
import { invitationService } from '@/features/auth/server/invitation-service'
import { DEFAULT_POLICY } from '@/lib/auth/password-policy'
import { db } from '@/lib/db/prisma'

export const metadata: Metadata = { title: 'Accept invitation' }

export const dynamic = 'force-dynamic'

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const result = await invitationService.inspectToken(token)

  if (result.state !== 'valid') {
    return <TokenStateCard state={result.state} flow="invite" />
  }

  const [settings, organization] = await Promise.all([
    db.setting.findUnique({
      where: { organizationId: result.invitation.organizationId },
      select: { passwordMinLength: true, passwordRequireMixed: true, companyName: true },
    }),
    db.organization.findUnique({
      where: { id: result.invitation.organizationId },
      select: { name: true },
    }),
  ])

  const orgName = settings?.companyName ?? organization?.name ?? 'the team'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to {orgName}</CardTitle>
        <CardDescription>Set a password to finish setting up your account.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {result.invitation.message && (
          <blockquote className="border-cyan bg-panel-2 text-muted-foreground border-l-2 py-2 pl-3 text-sm italic">
            {result.invitation.message}
          </blockquote>
        )}

        <SetPasswordForm
          mode="accept-invite"
          token={token}
          email={result.invitation.email}
          defaultName={result.invitation.name ?? undefined}
          policy={{
            minLength: settings?.passwordMinLength ?? DEFAULT_POLICY.minLength,
            requireMixed: settings?.passwordRequireMixed ?? DEFAULT_POLICY.requireMixed,
          }}
        />
      </CardContent>
    </Card>
  )
}
