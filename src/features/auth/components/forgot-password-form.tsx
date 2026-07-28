'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, MailCheckIcon } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { ForgotPasswordSchema, type ForgotPasswordInput } from '../schemas/auth.schema'
import { requestPasswordReset } from '../actions/auth.actions'

export function ForgotPasswordForm() {
  const [submitted, setSubmitted] = useState(false)

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(ForgotPasswordSchema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: ForgotPasswordInput) {
    await requestPasswordReset(values)
    // Always show the same confirmation. Reporting whether the address was found
    // would be an account-enumeration oracle, so the action itself never tells us.
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        <div
          role="status"
          className="border-go/40 bg-go-surface text-go flex gap-3 rounded-lg border px-3 py-3 text-sm"
        >
          <MailCheckIcon className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Check your inbox</p>
            <p className="mt-1 opacity-90">
              If that email is registered, a reset link is on its way. The link expires shortly, so
              use it soon.
            </p>
          </div>
        </div>

        <Button variant="outline" className="w-full" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    )
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="you@company.com"
                  disabled={isSubmitting}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
          {isSubmitting ? 'Sending…' : 'Send reset link'}
        </Button>

        <Button variant="ghost" className="w-full" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </form>
    </Form>
  )
}
