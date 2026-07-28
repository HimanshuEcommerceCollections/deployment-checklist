import 'server-only'

import pino from 'pino'

import { env } from '@/lib/config/env'

/**
 * Redaction paths — docs/12 §12.10.
 *
 * Anything matching these never reaches a log destination. The wildcard forms
 * matter: a secret nested inside a request body or an error `cause` is the one
 * that actually leaks in practice, not a top-level `password` field.
 */
const redactPaths = [
  'password',
  'passwordHash',
  'newPassword',
  'confirmPassword',
  'token',
  'tokenHash',
  'rawToken',
  'apiKey',
  'smtpSecretRef',
  'emailApiKeyRef',
  'secret',
  'authorization',
  'cookie',
  'set-cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.apiKey',
  '*.secret',
]

/**
 * No pino `transport`, deliberately.
 *
 * Transports run in a worker thread via thread-stream, and Next's bundler cannot
 * trace that worker entry — it fails with
 * "Cannot find module '.next/server/vendor-chunks/lib/worker.js'" and then
 * "the worker thread exited". Writing synchronously to stdout avoids the worker
 * entirely, which is also what you want on serverless where the process can be
 * frozen before an async transport flushes.
 *
 * For human-readable local logs, pipe instead: `npm run dev | npx pino-pretty`.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '«redacted»' },
  base: { env: env.NODE_ENV },
  formatters: {
    level: (label) => ({ level: label }),
  },
})

/**
 * Child logger bound to a request.
 *
 * `route` is the route PATTERN, never the resolved path — ids in log labels
 * explode cardinality and make every log query a scan.
 */
export function requestLogger(fields: {
  requestId: string
  actorId?: string
  route?: string
  organizationId?: string
}) {
  return logger.child(fields)
}

export type Logger = typeof logger
