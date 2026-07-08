/**
 * No-op unless VITE_SENTRY_DSN is set — dynamically imported so an unset DSN
 * (every dev machine, and prod until a real project exists) never pays for
 * the @sentry/react bundle at all.
 */
export async function initSentry(): Promise<void> {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  const Sentry = await import("@sentry/react");
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}
