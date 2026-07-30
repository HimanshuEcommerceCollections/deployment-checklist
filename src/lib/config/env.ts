import { z } from 'zod'

/**
 * Environment validation at boot.
 *
 * The point is failing at startup with a precise message instead of at the
 * first password reset at 2am. A missing SECRET_ENCRYPTION_KEY is a
 * configuration bug; discovering it when a user needs a reset link makes it an
 * incident.
 *
 * Client-exposed values are declared separately and must be NEXT_PUBLIC_*.
 * Everything else throws if read in the browser.
 */

const base64Bytes = (bytes: number) =>
  z.string().refine(
    (value) => {
      try {
        return Buffer.from(value, 'base64').length === bytes
      } catch {
        return false
      }
    },
    `Must be exactly ${bytes} bytes, base64-encoded. Generate with: node -e "console.log(require('crypto').randomBytes(${bytes}).toString('base64'))"`,
  )

const boolish = z
  .enum(['true', 'false', '1', '0', ''])
  .transform((v) => v === 'true' || v === '1')

/**
 * A boolean flag where absent — including `FOO=""` — means the stated default.
 *
 * `boolish` alone cannot express "default true", because it maps `''` to false.
 * A key left blank in .env.example would then silently mean "off", which is the
 * wrong answer for a switch that is on unless someone deliberately turns it off.
 */
const flag = (fallback: boolean) =>
  z.preprocess(
    (value) => (value === '' || value === undefined ? String(fallback) : value),
    boolish,
  )

/**
 * `FOO=""` in a .env file means "not set".
 *
 * Without this, every commented-out-but-present key in .env.example fails
 * validation as "invalid email" / "invalid url" rather than being treated as
 * absent — which is both wrong and a confusing first-run experience.
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional())

/**
 * Is this a build, rather than a running server?
 *
 * `next build` sets NODE_ENV=production, but a build machine legitimately does
 * NOT have production secrets — they are injected at deploy time. So SHAPE is
 * validated at build (a malformed value is a code problem), while production
 * POLICY is validated at runtime boot via instrumentation.ts.
 *
 * Conflating the two makes CI fail for a correct configuration, which teaches
 * people to disable the check — the opposite of what it is for.
 */
const isBuildPhase = () =>
  process.env.NEXT_PHASE === 'phase-production-build' ||
  process.env.SKIP_ENV_POLICY_CHECKS === 'true'

const serverSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // ── Database ─────────────────────────────────────────────────────────
    DATABASE_URL: z
      .string()
      .min(1, 'DATABASE_URL is required')
      .refine(
        (url) => url.startsWith('mongodb://') || url.startsWith('mongodb+srv://'),
        'Must be a mongodb:// or mongodb+srv:// connection string',
      )
      .refine(
        // mongodb+srv against Atlas is always a replica set; a plain mongodb://
        // URL must say so explicitly or transactions will fail at runtime.
        (url) => url.startsWith('mongodb+srv://') || url.includes('replicaSet='),
        'MongoDB must be a replica set — Prisma interactive transactions require one and this ' +
          'app depends on them. Add ?replicaSet=rs0&directConnection=true, or run `npm run dev:db`, ' +
          'or use MongoDB Atlas. See .env.example.',
      ),

    // ── Application ──────────────────────────────────────────────────────
    APP_URL: z.string().url('APP_URL must be an absolute URL, e.g. http://localhost:3000'),

    // ── Auth ─────────────────────────────────────────────────────────────
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
    AUTH_TRUST_HOST: boolish.default('true'),

    // ── Crypto ───────────────────────────────────────────────────────────
    SECRET_ENCRYPTION_KEY: base64Bytes(32),

    // ── Jobs ─────────────────────────────────────────────────────────────
    CRON_SECRET: z.string().min(32, 'CRON_SECRET must be at least 32 characters'),

    // ── Email ────────────────────────────────────────────────────────────
    /**
     * Master switch, owned by the deployment rather than by an admin.
     *
     * There is no email provider yet, so this is how the feature is turned off
     * without deleting the code path: outbox rows are still written inside their
     * transactions (so nothing is lost and the history is intact), and the worker
     * closes them out as skipped instead of constructing a transport.
     *
     * Flipping it to true later is the entire migration.
     */
    EMAIL_ENABLED: flag(true),
    /**
     * Who wins when the database `Setting` row and these variables disagree.
     *
     *   settings — admin UI wins per field, env fills the gaps (the default)
     *   env      — the settings row is ignored entirely for email transport
     *
     * `env` exists because `Setting.emailProvider` defaults to "gmail" in the
     * schema. A seeded or half-configured row therefore outranks
     * EMAIL_PROVIDER=console and the worker starts trying to reach Gmail with no
     * credentials. Pinning to env makes the deployment authoritative.
     */
    EMAIL_CONFIG_SOURCE: z.enum(['settings', 'env']).default('settings'),
    EMAIL_PROVIDER: z
      .enum(['console', 'gmail', 'smtp', 'resend', 'ses', 'noop'])
      .default('console'),
    SMTP_HOST: optional(z.string()),
    SMTP_PORT: optional(z.coerce.number().int().positive()),
    SMTP_SECURE: boolish.default('true'),
    SMTP_USERNAME: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    EMAIL_FROM_ADDRESS: optional(z.string().email()),
    EMAIL_FROM_NAME: z.string().default('Deployment Checklist'),
    EMAIL_REPLY_TO: optional(z.string().email()),
    GMAIL_VERIFIED_ALIASES: z.string().default(''),
    EMAIL_API_KEY: optional(z.string()),
    AWS_REGION: optional(z.string()),

    // ── Infrastructure ───────────────────────────────────────────────────
    REDIS_URL: optional(z.string()),
    SEARCH_BACKEND: z.enum(['atlas', 'regex']).default('regex'),

    // ── Seed ─────────────────────────────────────────────────────────────
    SEED_ORG_NAME: z.string().default('Acme Engineering'),
    SEED_ADMIN_EMAIL: z.string().email().default('admin@example.com'),
    SEED_ADMIN_NAME: z.string().default('Platform Admin'),
    SEED_ADMIN_PASSWORD: z.string().min(12).default('ChangeMeImmediately!2026'),
    SEED_ALLOW_PRODUCTION: boolish.default('false'),

    // ── Observability ────────────────────────────────────────────────────
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    SENTRY_DSN: optional(z.string()),
  })
  // Cross-field rules: a provider is only "configured" if its inputs are present.
  .superRefine((cfg, ctx) => {
    // Credentials are only required when email is actually on. With
    // EMAIL_ENABLED=false no transport is ever constructed, so demanding SMTP
    // credentials would block a deployment that has deliberately opted out —
    // which is exactly the situation the switch exists for.
    if (cfg.EMAIL_ENABLED) {
      if (cfg.EMAIL_PROVIDER === 'gmail' || cfg.EMAIL_PROVIDER === 'smtp') {
        for (const key of ['SMTP_HOST', 'SMTP_USERNAME', 'SMTP_PASSWORD'] as const) {
          if (!cfg[key]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [key],
              message: `${key} is required when EMAIL_PROVIDER="${cfg.EMAIL_PROVIDER}". Gmail needs a 16-character App Password, not the account password.`,
            })
          }
        }
        if (!cfg.EMAIL_FROM_ADDRESS) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['EMAIL_FROM_ADDRESS'],
            message: `EMAIL_FROM_ADDRESS is required when EMAIL_PROVIDER="${cfg.EMAIL_PROVIDER}".`,
          })
        }
      }

      if ((cfg.EMAIL_PROVIDER === 'resend' || cfg.EMAIL_PROVIDER === 'ses') && !cfg.EMAIL_API_KEY) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_API_KEY'],
          message: `EMAIL_API_KEY is required when EMAIL_PROVIDER="${cfg.EMAIL_PROVIDER}".`,
        })
      }
    }


    // Production POLICY guards — runtime only.
    // Skipped during `next build` because a build machine legitimately has no
    // production secrets; instrumentation.ts re-runs these at server boot.
    if (cfg.NODE_ENV === 'production' && !isBuildPhase()) {
      // The failure this guards against is silent: invitations and password
      // resets never arrive, and nobody can report it because they cannot log in.
      //
      // EMAIL_ENABLED=false is the sanctioned way out. It is not a loophole — it
      // is a deliberate, greppable statement that this deployment does not send
      // email, which the admin UI cannot contradict and the outbox records on
      // every skipped row. What is rejected is claiming to send while pointing at
      // a provider that writes to a terminal nobody is reading.
      if (
        cfg.EMAIL_ENABLED &&
        (cfg.EMAIL_PROVIDER === 'console' || cfg.EMAIL_PROVIDER === 'noop')
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_PROVIDER'],
          message:
            'EMAIL_PROVIDER cannot be "console" or "noop" in production while EMAIL_ENABLED is ' +
            'true — invitations and password resets would silently never arrive, and nobody can ' +
            'report it because they cannot log in. Either configure a real provider, or set ' +
            'EMAIL_ENABLED="false" to opt out of email deliberately.',
        })
      }
      if (cfg.APP_URL.startsWith('http://')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['APP_URL'],
          message: 'APP_URL must use https in production — session cookies are Secure-only.',
        })
      }
      if (cfg.SEED_ALLOW_PRODUCTION) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SEED_ALLOW_PRODUCTION'],
          message: 'SEED_ALLOW_PRODUCTION must not be true in a live production environment.',
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof serverSchema>

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
}

function loadServerEnv(): ServerEnv {
  const parsed = serverSchema.safeParse(process.env)

  if (!parsed.success) {
    // Deliberately loud and specific. This is the one error message that saves
    // the most time across the life of the project.
    const message =
      '\n╭─ Invalid environment configuration ' +
      '─'.repeat(34) +
      '\n' +
      formatIssues(parsed.error) +
      '\n\n  Copy .env.example to .env.local and fill in the missing values.\n' +
      '╰' +
      '─'.repeat(70) +
      '\n'

    throw new Error(message)
  }

  return parsed.data
}

/**
 * Validated server environment.
 *
 * Guarded rather than eagerly evaluated so that importing a module which
 * transitively touches this file from a Client Component produces a clear
 * error instead of leaking values into the browser bundle.
 */
export const env: ServerEnv = new Proxy({} as ServerEnv, {
  get(_target, prop: string) {
    if (typeof window !== 'undefined') {
      throw new Error(
        `Attempted to read server env "${prop}" in the browser. Server-only values must not ` +
          `cross into Client Components — pass them as props from a Server Component instead.`,
      )
    }
    cached ??= loadServerEnv()
    return cached[prop as keyof ServerEnv]
  },
})

let cached: ServerEnv | null = null

/** Force validation now. Called from instrumentation so boot fails fast. */
export function assertEnv(): void {
  cached ??= loadServerEnv()
}

export const isProduction = () => env.NODE_ENV === 'production'
export const isDevelopment = () => env.NODE_ENV === 'development'
export const isTest = () => env.NODE_ENV === 'test'
