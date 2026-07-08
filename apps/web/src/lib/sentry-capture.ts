/** Dynamically imported so error boundaries never pull in @sentry/react when no DSN is configured. */
export async function captureException(error: unknown): Promise<void> {
  if (!(import.meta.env.VITE_SENTRY_DSN as string | undefined)) return;
  const Sentry = await import("@sentry/react");
  Sentry.captureException(error);
}
