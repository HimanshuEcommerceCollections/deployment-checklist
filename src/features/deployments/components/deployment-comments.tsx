'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

import { addDeploymentComment } from '../actions/deployments.actions'

export interface DeploymentCommentView {
  id: string
  /** The model field is `body`. This component used to read `content`. */
  body: string
  createdAt: string | Date
  authorName: string | null
  author?: { name: string | null } | null
}

interface DeploymentCommentsProps {
  deploymentId: string
  comments: DeploymentCommentView[]
}

export function DeploymentComments({ deploymentId, comments }: DeploymentCommentsProps) {
  const router = useRouter()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!body.trim()) return

    setError(null)

    /**
     * `body`, not `content`. The schema is `.strict()`, so the old payload was
     * rejected twice over — an unrecognised key and a missing required one — and
     * because the result was never checked before a `window.location.reload()`,
     * every comment vanished with no message at all.
     */
    const result = await addDeploymentComment(deploymentId, { body: body.trim() })

    if (!result.ok) {
      setError(result.message)
      return
    }

    setBody('')
    startTransition(() => router.refresh())
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments ({comments.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {comments.length > 0 && (
          <div className="space-y-4">
            {comments.map((comment) => (
              <div key={comment.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    {comment.author?.name ?? comment.authorName ?? 'Unknown'}
                  </div>
                  <time
                    dateTime={new Date(comment.createdAt).toISOString()}
                    className="text-sm text-muted-foreground"
                  >
                    {new Date(comment.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm">{comment.body}</p>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 border-t pt-6">
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Textarea
            placeholder="Add a comment…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={pending}
            maxLength={5000}
            aria-label="Comment"
          />
          <Button type="submit" disabled={pending || !body.trim()}>
            {pending ? 'Posting…' : 'Post comment'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
