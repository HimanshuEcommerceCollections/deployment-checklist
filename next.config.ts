import type { NextConfig } from 'next'

/**
 * Security headers — see docs/12-security.md §12.5.
 *
 * CSP note: `style-src` needs 'unsafe-inline' because Tailwind's runtime and
 * Radix both set inline style attributes. Scripts do NOT get it — script-src is
 * where XSS actually lands, and Next injects a nonce there automatically when a
 * nonce is present in the CSP.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // 'unsafe-eval' is required by React's dev refresh runtime only.
  process.env.NODE_ENV === 'development'
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  ...(process.env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Argon2 and Nodemailer are native/Node-only; keep them out of the bundle.
  serverExternalPackages: ['@node-rs/argon2', 'nodemailer', '@prisma/client'],

  experimental: {
    // Server Actions are same-origin only by default; this is belt-and-braces
    // for deployments behind a proxy that rewrites Origin.
    serverActions: { bodySizeLimit: '4mb' },
  },

  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
