'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { transitionDeployment } from '../actions/deployments.actions'

/** Exactly what `DeploymentsService.availableTransitions` returns. */
export interface TransitionOption {
  name: string
  label: string
  confirm: string
  reasonRequired: boolean
  available: boolean
  unavailable: string | null
}

interface DeploymentStatusActionsProps {
  deploymentId: string
  reference: string
  options: TransitionOption[]
  /** `destructive` styling for the terminal verbs; the rest stay neutral. */
  className?: string
}

const DESTRUCTIVE = new Set(['fail', 'cancel', 'rollback'])
const PRIMARY = new Set(['start', 'complete'])

export function DeploymentStatusActions({
  deploymentId,
  reference,
  options,
  className,
}: DeploymentStatusActionsProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [active, setActive] = useState<TransitionOption | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (options.length === 0) return null

  function open(option: TransitionOption) {
    setActive(option)
    setReason('')
    setError(null)
  }

  function close() {
    if (pending) return
    setActive(null)
    setError(null)
  }

  function submit() {
    if (!active) return

    const trimmed = reason.trim()
    if (active.reasonRequired && !trimmed) {
      setError('Please give a brief reason — it is recorded on the run.')
      return
    }

    startTransition(async () => {
      const result = await transitionDeployment(deploymentId, {
        transition: active.name,
        // The schema is `.strict()` with an optional reason, so an empty string
        // must be omitted rather than sent.
        ...(trimmed ? { reason: trimmed } : {}),
      })

      if (!result.ok) {
        setError(result.message)
        return
      }

      setActive(null)
      toast.success(`${reference} is now ${result.data.status.toLowerCase().replace(/_/g, ' ')}`)
      router.refresh()
    })
  }

  return (
    <>
      <div className={className ?? 'flex flex-wrap items-center gap-2'}>
        {options.map((option) => (
          <Button
            key={option.name}
            size="sm"
            variant={
              PRIMARY.has(option.name)
                ? 'default'
                : DESTRUCTIVE.has(option.name)
                  ? 'destructive'
                  : 'secondary'
            }
            disabled={!option.available || pending}
            /// The reason a transition is unavailable is the useful part, so it
            /// stays on the disabled button rather than vanishing with it.
            title={option.unavailable ?? undefined}
            onClick={() => open(option)}
          >
            {option.label}
          </Button>
        ))}
      </div>

      {options.some((o) => !o.available && o.unavailable) && (
        <ul className="mt-2 space-y-1">
          {options
            .filter((o) => !o.available && o.unavailable)
            .map((o) => (
              <li key={o.name} className="text-xs text-muted-foreground">
                <span className="font-medium">{o.label}</span> — {o.unavailable}
              </li>
            ))}
        </ul>
      )}

      <Dialog open={active !== null} onOpenChange={(next) => (next ? undefined : close())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {active?.label} — {reference}
            </DialogTitle>
            <DialogDescription>{active?.confirm}</DialogDescription>
          </DialogHeader>

          {active?.reasonRequired && (
            <div className="space-y-2">
              <Label htmlFor="transition-reason">Reason</Label>
              <Textarea
                id="transition-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                disabled={pending}
                placeholder="Recorded on the run and in the audit trail."
                autoFocus
              />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant={active && DESTRUCTIVE.has(active.name) ? 'destructive' : 'default'}
              onClick={submit}
              disabled={pending}
            >
              {pending ? 'Working…' : (active?.label ?? 'Confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
