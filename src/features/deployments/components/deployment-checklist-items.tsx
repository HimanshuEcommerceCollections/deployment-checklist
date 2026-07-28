'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { updateDeploymentItem } from '../actions/deployments.actions'

interface DeploymentChecklistItemsProps {
  deploymentId: string
  items: any[]
}

export function DeploymentChecklistItems({
  deploymentId,
  items,
}: DeploymentChecklistItemsProps) {
  const handleCheck = async (itemId: string, checked: boolean) => {
    await updateDeploymentItem(deploymentId, itemId, { checked, skipped: false })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Checklist Items</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.length === 0 ? (
            <p className="text-gray-600">No items in this deployment.</p>
          ) : (
            items.map((item: any) => (
              <label key={item.id} className="flex items-start gap-3 rounded-lg p-3 hover:bg-gray-50">
                <input
                  type="checkbox"
                  checked={item.checked || false}
                  onChange={(e) => handleCheck(item.id, e.target.checked)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className={item.checked ? 'line-through text-gray-500' : ''}>
                    {item.title}
                  </p>
                  {item.description && (
                    <p className="text-sm text-gray-600">{item.description}</p>
                  )}
                </div>
              </label>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
