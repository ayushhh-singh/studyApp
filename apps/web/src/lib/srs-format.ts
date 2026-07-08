/** Short "in Xm/Xh/Xd/Xmo/Xy" label for an FSRS rating preview's due_at, relative to now. */
export function formatSrsInterval(dueAtIso: string, now: Date = new Date()): string {
  const diffMs = new Date(dueAtIso).getTime() - now.getTime();
  const minutes = diffMs / 60_000;
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
