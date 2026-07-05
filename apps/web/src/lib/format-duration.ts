/** Whole seconds -> "42s" / "3m 05s" — used for per-question and average time displays. */
export function formatSeconds(seconds: number): string {
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${minutes}m ${String(rest).padStart(2, "0")}s`;
}
