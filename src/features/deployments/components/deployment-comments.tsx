'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { addDeploymentComment } from '../actions/deployments.actions'

interface DeploymentCommentsProps {
  deploymentId: string
  comments: any[]
}

export function DeploymentComments({
  deploymentId,
  comments,
}: DeploymentCommentsProps) {
  const [content, setContent] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) return

    setIsSubmitting(true)
    try {
      await addDeploymentComment(deploymentId, { content })
      setContent('')
      // In a real app, would refresh or update state
      window.location.reload()
    } catch (error) {
      console.error(error)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Comments ({comments.length})</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {comments.length > 0 && (
          <div className="space-y-4">
            {comments.map((comment: any) => (
              <div key={comment.id} className="rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{comment.author?.name}</div>
                  <div className="text-sm text-gray-600">
                    {new Date(comment.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-gray-700">
                  {comment.content}
                </p>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 border-t pt-6">
          <Textarea
            placeholder="Add a comment..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={isSubmitting}
            maxLength={5000}
          />
          <Button type="submit" disabled={isSubmitting || !content.trim()}>
            {isSubmitting ? 'Posting...' : 'Post Comment'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
