'use client'

/**
 * Last-resort boundary: only reached when the ROOT layout itself throws, which
 * means the document — and with it globals.css and the Tailwind theme — never
 * rendered. Everything here is inline styles for exactly that reason; a class
 * name would silently do nothing on the one page where this component appears.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '12px',
          fontFamily: "'Segoe UI', system-ui, sans-serif",
          background: '#0a0e17',
          color: '#e7ecf3',
          textAlign: 'center',
          padding: '24px',
        }}
      >
        <p style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.16em', color: '#4fc7e8', textTransform: 'uppercase', fontWeight: 700 }}>
          // error
        </p>
        <h1 style={{ fontSize: 22, margin: 0 }}>The application failed to load</h1>
        <p style={{ fontSize: 14, color: '#93a1b8', maxWidth: 420, margin: 0 }}>
          Something failed before the page could even be set up. Reloading usually clears it.
        </p>
        {error.digest && (
          <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#93a1b8' }}>ref: {error.digest}</p>
        )}
        <button
          onClick={reset}
          style={{
            marginTop: 8,
            padding: '8px 20px',
            borderRadius: 8,
            border: '1px solid #22314a',
            background: '#111a2b',
            color: '#e7ecf3',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </body>
    </html>
  )
}
