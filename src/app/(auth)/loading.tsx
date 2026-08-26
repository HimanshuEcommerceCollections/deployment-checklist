/**
 * Full-page loader for the auth screens — login, accept-invite, reset-password.
 * These render outside the app shell, so without this the first load is a blank
 * page while the route compiles and the session check runs.
 */
export default function AuthLoading() {
  return (
    <div
      className="flex min-h-svh items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div className="flex flex-col items-center gap-4">
        <span className="size-10 animate-spin rounded-full border-4 border-line border-t-cyan" />
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Loading…
        </span>
      </div>
    </div>
  )
}
