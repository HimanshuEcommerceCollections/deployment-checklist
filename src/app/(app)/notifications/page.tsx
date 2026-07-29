'use client'

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

export default function NotificationsPage() {
  const [prefs, setPrefs] = useState({
    deploymentStarted: true,
    deploymentCompleted: true,
    deploymentFailed: true,
    commentMentioned: true,
    weeklyDigest: false,
    emailNotifications: true,
    slackNotifications: false,
  })

  const handleChange = (key: keyof typeof prefs) => {
    setPrefs((p) => ({ ...p, [key]: !p[key] }))
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Notification Preferences</h1>
        <p className="text-gray-600 mt-2">Control how and when you receive notifications</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Deployment Events</CardTitle>
          <CardDescription>Receive notifications about deployment status changes</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.deploymentStarted}
              onChange={() => handleChange('deploymentStarted')}
            />
            <span>Notify when deployment starts</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.deploymentCompleted}
              onChange={() => handleChange('deploymentCompleted')}
            />
            <span>Notify when deployment completes</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.deploymentFailed}
              onChange={() => handleChange('deploymentFailed')}
            />
            <span>Notify when deployment fails</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Collaboration</CardTitle>
          <CardDescription>Receive notifications about comments and mentions</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.commentMentioned}
              onChange={() => handleChange('commentMentioned')}
            />
            <span>Notify when mentioned in a comment</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.weeklyDigest}
              onChange={() => handleChange('weeklyDigest')}
            />
            <span>Send weekly activity digest</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notification Channels</CardTitle>
          <CardDescription>Choose where to receive notifications</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.emailNotifications}
              onChange={() => handleChange('emailNotifications')}
            />
            <span>Email Notifications</span>
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={prefs.slackNotifications}
              onChange={() => handleChange('slackNotifications')}
            />
            <span>Slack Notifications (requires integration)</span>
          </label>
        </CardContent>
      </Card>

      <Button onClick={() => {}}>Save Preferences</Button>
    </div>
  )
}
