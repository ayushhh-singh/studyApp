/** No-op unless SENTRY_DSN is set — never imported eagerly at module scope elsewhere, so an unconfigured server pays nothing. */
export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({ dsn, environment: process.env.NODE_ENV ?? "development", tracesSampleRate: 0.1 });
}

export async function captureException(error: unknown): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/node");
  Sentry.captureException(error);
}
