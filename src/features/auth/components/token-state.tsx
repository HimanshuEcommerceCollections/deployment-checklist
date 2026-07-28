import { AlertTriangleIcon, ClockIcon, CheckCircle2Icon, XCircleIcon } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export type TokenState = 'invalid' | 'expired' | 'used' | 'revoked'

/**
 * Explains an unusable invite or reset link.
 *
 * Each state gets its own copy and its own next action. A single generic
 * "invalid link" page is where support tickets come from — "expired" and
 * "already used" are ordinary situations with different remedies, and telling
 * the user which one they hit costs nothing security-wise (they already hold
 * the token).
 */
const COPY: Record<
  TokenState,
  { title: string; description: string; action: 'reset' | 'login' | 'contact'; icon: typeof ClockIcon }
> = {
  expired: {
    title: 'This link has expired',
    description:
      'Links are short-lived for security. Request a new one and it will arrive in a moment.',
    action: 'reset',
    icon: ClockIcon,
  },
  used: {
    title: 'This link has already been used',
    description:
      'Each link works only once. If you already set your password, sign in. If not, request a new link.',
    action: 'login',
    icon: CheckCircle2Icon,
  },
  revoked: {
    title: 'This invitation was withdrawn',
    description: 'An administrator revoked this invitation. Contact them if you think that is a mistake.',
    action: 'contact',
    icon: XCircleIcon,
  },
  invalid: {
    title: 'This link is not valid',
    description:
      'It may have been copied incompletely. Check that you used the whole link from the email, or request a new one.',
    action: 'reset',
    icon: AlertTriangleIcon,
  },
}

export function TokenStateCard({ state, flow }: { state: TokenState; flow: 'invite' | 'reset' }) {
  const copy = COPY[state]
  const Icon = copy.icon

  return (
    <Card>
      <CardHeader>
        <div className="border-hold/40 bg-hold-surface text-hold mb-3 flex size-10 items-center justify-center rounded-lg border">
          <Icon className="size-5" />
        </div>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {copy.action === 'reset' && flow === 'reset' && (
          <Button className="w-full" asChild>
            <Link href="/forgot-password">Request a new link</Link>
          </Button>
        )}

        {copy.action === 'reset' && flow === 'invite' && (
          <p className="text-muted-foreground text-sm">
            Ask an administrator to send you a new invitation.
          </p>
        )}

        {copy.action === 'contact' && (
          <p className="text-muted-foreground text-sm">
            Access to this application is by invitation only.
          </p>
        )}

        <Button variant={copy.action === 'login' ? 'default' : 'outline'} className="w-full" asChild>
          <Link href="/login">Go to sign in</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
