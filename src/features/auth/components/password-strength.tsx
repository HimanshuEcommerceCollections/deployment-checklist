'use client'

import { CheckIcon, XIcon } from 'lucide-react'

import { checkPassword, type PasswordPolicy } from '@/lib/auth/password-policy'
import { cn } from '@/lib/utils'

/**
 * Live password feedback.
 *
 * Runs the SAME `checkPassword` the server enforces — it is a pure function with
 * no server-only import precisely so the rules cannot drift between the hint the
 * user sees and the rule that rejects them.
 */
export function PasswordStrength({
  password,
  policy,
  context,
}: {
  password: string
  policy?: PasswordPolicy
  context?: { email?: string; name?: string }
}) {
  if (!password) return null

  const result = checkPassword(password, policy, context)

  const barColor =
    result.strength === 'weak'
      ? 'bg-blocked'
      : result.strength === 'fair'
        ? 'bg-hold'
        : 'bg-go'

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-center gap-2">
        <div
          className="bg-line h-1 flex-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuenow={result.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Password strength"
        >
          <div
            className={cn('h-full rounded-full transition-all', barColor)}
            style={{ width: `${Math.max(6, result.score)}%` }}
          />
        </div>
        <span
          className={cn(
            'font-mono text-[10px] font-bold uppercase tracking-wider',
            result.strength === 'weak'
              ? 'text-blocked'
              : result.strength === 'fair'
                ? 'text-hold'
                : 'text-go',
          )}
        >
          {result.strength}
        </span>
      </div>

      {/* aria-live so the list is announced as it changes, but polite so it does
          not interrupt typing. */}
      <ul className="space-y-1" aria-live="polite">
        {result.problems.length === 0 ? (
          <li className="text-go flex items-center gap-1.5 text-xs">
            <CheckIcon className="size-3.5 shrink-0" />
            Meets all requirements
          </li>
        ) : (
          result.problems.map((problem) => (
            <li key={problem} className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <XIcon className="text-blocked mt-0.5 size-3.5 shrink-0" />
              {problem}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
