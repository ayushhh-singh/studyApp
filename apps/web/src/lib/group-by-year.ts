/**
 * Groups items by their real exam year, descending; a missing year (e.g. an
 * un-dated custom test, or a PYQ whose year wasn't captured at ingest) sorts
 * last under an "unknown" bucket. Shared by Practice's PYQ-papers tab and the
 * Answers PYQ picker — both group already-fetched lists by year the same way.
 */
export function groupByYearDescending<T extends { year: number | null }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.year != null ? String(item.year) : "unknown";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return Number(b) - Number(a);
  });
}
