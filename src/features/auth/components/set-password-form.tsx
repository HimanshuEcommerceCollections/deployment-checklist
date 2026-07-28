'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import type { PasswordPolicy } from '@/lib/auth/password-policy'

import { AcceptInviteSchema, ResetPasswordSchema } from '../schemas/auth.schema'
import { acceptInvite, resetPassword } from '../actions/auth.actions'
import { PasswordStrength } from './password-strength'

/**
 * Shared password-setting form.
 *
 * Backs both flows because they are the same interaction — the only differences
 * are whether a name is collected and where the user lands afterwards. Two
 * near-identical forms would drift.
 */
type Mode = 'accept-invite' | 'reset'

interface Props {
  mode: Mode
  token: string
  email: string
  defaultName?: string
  policy: PasswordPolicy
}

type Values = {
  token: string
  name?: string
  password: string
  confirmPassword: string
}

export function SetPasswordForm({ mode, token, email, defaultName, policy }: Props) {
  const router = useRouter()
  const [formError, setFormError] = useState<string | null>(null)
  const isInvite = mode === 'accept-invite'

  const form = useForm<Values>({
    resolver: zodResolver(isInvite ? AcceptInviteSchema : ResetPasswordSchema),
    defaultValues: {
      token,
      ...(isInvite ? { name: defaultName ?? '' } : {}),
      password: '',
      confirmPassword: '',
    },
  })

  const password = form.watch('password')
  const name = form.watch('name')

  async function onSubmit(values: Values) {
    setFormError(null)

    const result = isInvite ? await acceptInvite(values) : await resetPassword(values)

    if (!result.ok) {
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (field === 'password' || field === 'confirmPassword' || field === 'name') {
            form.setError(field as keyof Values, { message: messages[0] })
          }
        }
        // A field-level error is already visible on the input.
        if (Object.keys(result.fieldErrors).length > 0) return
      }
      setFormError(result.message)
      return
    }

    if (isInvite && 'redirectTo' in result.data) {
      toast.success('Welcome aboard')
      router.refresh()
      router.push(result.data.redirectTo)
      return
    }

    // Reset flow: sessions were just invalidated, so sign in explicitly rather
    // than dropping them into an app they no longer have a valid session for.
    router.push('/login?reset=success')
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && (
          <div
            role="alert"
            className="border-blocked/40 bg-blocked-surface text-blocked rounded-lg border px-3 py-2.5 text-sm"
          >
            {formError}
          </div>
        )}

        {/* Read-only, and not submitted: the email comes from the token
            server-side. Accepting it from the form would let someone retarget an
            invitation to a different address. */}
        <FormItem>
          <FormLabel>Email</FormLabel>
          <Input value={email} readOnly disabled className="font-mono text-sm" />
        </FormItem>

        {isInvite && (
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Your name</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="name"
                    autoFocus
                    placeholder="Priya Kulkarni"
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormDescription>Shown next to deployments and checklist items you complete.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{isInvite ? 'Choose a password' : 'New password'}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  autoComplete="new-password"
                  autoFocus={!isInvite}
                  disabled={isSubmitting}
                />
              </FormControl>
              <PasswordStrength password={password} policy={policy} context={{ email, name }} />
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm password</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="password"
                  autoComplete="new-password"
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
          {isSubmitting
            ? 'Saving…'
            : isInvite
              ? 'Set password and continue'
              : 'Change password'}
        </Button>
      </form>
    </Form>
  )
}
