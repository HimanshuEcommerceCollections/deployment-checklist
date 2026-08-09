import { listApiKeys } from '@/features/admin/actions/api-keys.actions'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { RevokeApiKeyButton } from '@/features/admin/components/revoke-api-key-button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'

export const metadata = { title: 'API Keys' }

export default async function ApiKeysPage() {
  const keys = await listApiKeys()

  const isExpired = (expiresAt: Date | null) => expiresAt && new Date(expiresAt) < new Date()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">API Keys</h1>
        <Link href="/admin/api-keys/new">
          <Button>Create API Key</Button>
        </Link>
      </div>

      {keys.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-gray-600">No API keys yet.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Last Used</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell className="font-mono text-sm">{key.prefix}...</TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-wrap gap-1">
                      {key.scopes.slice(0, 2).map((scope: string) => (
                        <Badge key={scope} variant="secondary" className="text-xs">
                          {scope}
                        </Badge>
                      ))}
                      {key.scopes.length > 2 && (
                        <Badge variant="secondary" className="text-xs">
                          +{key.scopes.length - 2}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {key.expiresAt ? (
                      <>
                        {new Date(key.expiresAt).toLocaleDateString()}
                        {isExpired(key.expiresAt) && (
                          <Badge variant="destructive" className="ml-2">
                            Expired
                          </Badge>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-500">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600">
                    {key.lastUsedAt
                      ? new Date(key.lastUsedAt).toLocaleDateString()
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    {key.revokedAt ? (
                      <Badge variant="secondary">Revoked</Badge>
                    ) : (
                      <RevokeApiKeyButton keyId={key.id} name={key.name} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
