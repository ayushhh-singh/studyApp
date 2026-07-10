/**
 * PostgREST caps any `.select()` at 1000 rows. Any query that reads an UNBOUNDED
 * set (the whole question bank, all published MCQs, all test memberships, …) must
 * page past that cap or it silently truncates once the table exceeds 1000 rows —
 * a bug that only appears at scale (it bit ingest:tests, embed, mastery, and the
 * daily-quiz pool once the PYQ bank tripled). Use this for every such read.
 *
 *   const rows = await selectAll<Row>(() =>
 *     supabase().from("questions").select("id, marks").eq("is_published", true));
 *
 * `build` must return a FRESH query each call (`.range()` is applied per page).
 */
// `build` returns a fresh PostgREST query builder each call — its precise
// generic type is unwieldy, so `any` here (the caller supplies the row type T).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function selectAll<T>(build: () => any): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
