/**
 * Scheduled test series — reads, the window gate, and the access gate.
 *
 * ---------------------------------------------------------------------------
 * THE WINDOW RULE IS THE MARKET'S OWN, VERBATIM: "allowing for test
 * postponement but not preponement" (Vision IAS's published schedule,
 * docs/test-series-design.md §2.4). So the gate is asymmetric on purpose, and
 * the asymmetry is the whole feature:
 *
 *   before opens_at    LOCKED. Nobody sees the paper early; that is what makes
 *                      a shared rank mean anything.
 *   after opens_at     OPEN, and it never closes. A student who is a week
 *                      behind still gets the paper.
 *   after ranked_until OPEN, but the attempt does not place. The board's
 *                      predicate (migration 0127) drops it; nothing here has to
 *                      do anything, which is why `closes_at` is NOT a gate.
 *
 * A common wrong implementation is to gate on `closes_at` as well. That turns
 * "postpone" into "miss", which is the opposite of the published rule.
 *
 * ---------------------------------------------------------------------------
 * ⚑ ACCESS IS DELIBERATELY NARROW UNTIL PRICING IS DECIDED. The entitlement
 * that should govern a series (is it inside Pro? is GS priced separately from
 * CSAT, as the market prices them at ₹16,000 vs ₹9,000?) is an open product
 * question — docs/test-series-design.md Q3/Q10 — and no schema for it exists in
 * this repo. Rather than invent one, or ship the feature open, a series is
 * visible only when BOTH hold:
 *
 *   1. its exam is live, and it is the viewer's own exam, and
 *   2. the series is `published`, or the viewer is an admin.
 *
 * That lets the owner see and exercise the real thing end to end while a
 * `draft` series stays invisible to everyone else, and it means turning the
 * product on later is a status change plus one entitlement call added to
 * `assertSeriesAccess` — not a rewrite. Both series built so far are `draft`.
 */
import type {
  AttemptSeriesContext,
  SeriesEntryState,
  TestSeriesDetail,
  TestSeriesEntry,
  TestSeriesSummary,
} from "@neev/shared";
import { HttpError, notFound } from "../lib/http-error.js";
import { supabase } from "../lib/supabase.js";
import { isCurrentUserAdmin } from "../lib/admin.js";
import { getUserExam } from "../lib/exams.js";

const SERIES_COLUMNS =
  "id, slug, exam_code, stage, paper_scope, title_i18n, description_i18n, status, starts_on, ends_on, target_exam_year";

const ENTRY_COLUMNS =
  "id, series_id, test_id, sequence_no, entry_kind, opens_at, closes_at, ranked_until, syllabus_note_i18n, sources_i18n, meta";

interface SeriesRow {
  id: string;
  slug: string;
  exam_code: string;
  stage: string;
  paper_scope: string | null;
  title_i18n: { en: string; hi: string };
  description_i18n: { en: string; hi: string } | null;
  status: string;
  starts_on: string;
  ends_on: string;
  target_exam_year: number | null;
}

interface EntryRow {
  id: string;
  series_id: string;
  test_id: string;
  sequence_no: number;
  entry_kind: string;
  opens_at: string;
  closes_at: string | null;
  ranked_until: string | null;
  syllabus_note_i18n: { en: string; hi: string } | null;
  sources_i18n: { en: string; hi: string } | null;
  meta: Record<string, unknown> | null;
}

/**
 * Which series a viewer may see at all — resolved as INPUTS, then applied by
 * each caller.
 *
 * ⚑ Deliberately NOT a helper that returns a ready-made query builder. A
 * PostgREST builder is thenable, so `await buildQuery()` on an async factory
 * resolves the promise INTO the builder and executes it — the caller gets a
 * finished response and every filter it meant to chain afterwards is a type
 * error at best and a silently unfiltered query at worst. Returning plain data
 * makes that shape impossible.
 *
 * Admin-visible drafts are the ONLY widening; everything else is the viewer's
 * own live exam. The status filter is applied in SQL rather than in JS so a
 * future paginated listing cannot silently return short pages.
 */
async function seriesVisibility(userId: string): Promise<{ examCode: string; admin: boolean }> {
  const [examCode, admin] = await Promise.all([getUserExam(userId), isCurrentUserAdmin()]);
  return { examCode, admin };
}

/**
 * The status predicate as a PostgREST filter string. An admin sees drafts too;
 * everyone else sees only published. Applied as a filter rather than in JS —
 * see the note above.
 */
function statusFilter(admin: boolean): { col: "status"; op: "eq" | "neq"; val: string } {
  return admin ? { col: "status", op: "neq", val: "archived" } : { col: "status", op: "eq", val: "published" };
}

/**
 * Per-entry state, derived — there is no state column and there must not be
 * one (§5.5). Every value below is a comparison against `now`, so a series
 * needs no scheduled job to open a test; §7.1.
 */
export function entryStateFor(
  entry: { opens_at: string; ranked_until: string | null },
  attempt: { submitted_at: string | null } | undefined,
  now: Date,
): SeriesEntryState {
  if (now < new Date(entry.opens_at)) return "locked";
  if (!attempt) return "open";
  if (!attempt.submitted_at) return "in_progress";
  if (entry.ranked_until && new Date(attempt.submitted_at) > new Date(entry.ranked_until)) return "submitted_late";
  return "submitted";
}

export async function listSeries(userId: string): Promise<TestSeriesSummary[]> {
  const vis = await seriesVisibility(userId);
  const f = statusFilter(vis.admin);
  const base = supabase().from("test_series").select(SERIES_COLUMNS).eq("exam_code", vis.examCode);
  const { data, error } = await (f.op === "eq" ? base.eq(f.col, f.val) : base.neq(f.col, f.val)).order("starts_on", {
    ascending: true,
  });
  if (error) throw new HttpError(500, `series list failed: ${error.message}`);
  const rows = (data ?? []) as SeriesRow[];
  if (rows.length === 0) return [];

  // Entry counts and the viewer's own progress, in two queries rather than
  // per-series (an N+1 here would run once per series on the index page).
  const ids = rows.map((r) => r.id);
  const { data: entries, error: entErr } = await supabase()
    .from("test_series_entries")
    .select("series_id, test_id, opens_at, ranked_until")
    .in("series_id", ids);
  if (entErr) throw new HttpError(500, `series entries lookup failed: ${entErr.message}`);
  const entryRows = (entries ?? []) as { series_id: string; test_id: string; opens_at: string; ranked_until: string | null }[];

  const attempts = await attemptsByTest(userId, entryRows.map((e) => e.test_id));
  const now = new Date();

  return rows.map((s) => {
    const mine = entryRows.filter((e) => e.series_id === s.id);
    let open = 0;
    let done = 0;
    for (const e of mine) {
      const st = entryStateFor(e, attempts.get(e.test_id), now);
      if (st === "open" || st === "in_progress") open += 1;
      if (st === "submitted" || st === "submitted_late") done += 1;
    }
    return {
      id: s.id,
      slug: s.slug,
      exam_code: s.exam_code,
      stage: s.stage as TestSeriesSummary["stage"],
      paper_scope: s.paper_scope,
      title_i18n: s.title_i18n,
      description_i18n: s.description_i18n,
      status: s.status as TestSeriesSummary["status"],
      starts_on: s.starts_on,
      ends_on: s.ends_on,
      target_exam_year: s.target_exam_year,
      entry_count: mine.length,
      open_count: open,
      completed_count: done,
    };
  });
}

/** The viewer's first submitted (or in-flight) attempt per test. */
async function attemptsByTest(
  userId: string,
  testIds: string[],
): Promise<Map<string, { submitted_at: string | null; id: string; score: number | null; total: number | null }>> {
  const out = new Map<string, { submitted_at: string | null; id: string; score: number | null; total: number | null }>();
  if (testIds.length === 0) return out;
  for (let i = 0; i < testIds.length; i += 100) {
    const { data, error } = await supabase()
      .from("attempts")
      .select("id, test_id, submitted_at, score, total")
      .eq("user_id", userId)
      .in("test_id", testIds.slice(i, i + 100))
      // Earliest first, so the first row we keep per test is the one the board
      // also counts (v_test_leaderboard takes row_number() = 1 by submitted_at).
      .order("submitted_at", { ascending: true, nullsFirst: false });
    if (error) throw new HttpError(500, `attempt lookup failed: ${error.message}`);
    for (const a of (data ?? []) as { id: string; test_id: string; submitted_at: string | null; score: number | null; total: number | null }[]) {
      const prev = out.get(a.test_id);
      // Prefer a submitted attempt; otherwise keep an in-flight one.
      if (!prev || (!prev.submitted_at && a.submitted_at)) {
        out.set(a.test_id, { id: a.id, submitted_at: a.submitted_at, score: a.score, total: a.total });
      }
    }
  }
  return out;
}

export async function getSeriesBySlug(userId: string, slug: string): Promise<TestSeriesDetail> {
  const vis = await seriesVisibility(userId);
  const f = statusFilter(vis.admin);
  const base = supabase()
    .from("test_series")
    .select(SERIES_COLUMNS)
    .eq("exam_code", vis.examCode)
    .eq("slug", slug);
  const { data, error } = await (f.op === "eq" ? base.eq(f.col, f.val) : base.neq(f.col, f.val)).maybeSingle();
  if (error) throw new HttpError(500, `series lookup failed: ${error.message}`);
  if (!data) throw notFound("Test series not found");
  const s = data as SeriesRow;

  const { data: entries, error: entErr } = await supabase()
    .from("test_series_entries")
    .select(`${ENTRY_COLUMNS}, tests!inner(title_i18n, paper_code, duration_minutes, total_marks, test_questions(count))`)
    .eq("series_id", s.id)
    .order("sequence_no", { ascending: true });
  if (entErr) throw new HttpError(500, `series entries lookup failed: ${entErr.message}`);

  const rows = (entries ?? []) as unknown as (EntryRow & {
    tests: {
      title_i18n: { en: string; hi: string };
      paper_code: string | null;
      duration_minutes: number | null;
      total_marks: number | null;
      test_questions: { count: number }[];
    };
  })[];

  const attempts = await attemptsByTest(userId, rows.map((r) => r.test_id));
  const now = new Date();

  const mapped: TestSeriesEntry[] = rows.map((r) => {
    const a = attempts.get(r.test_id);
    return {
      id: r.id,
      test_id: r.test_id,
      sequence_no: r.sequence_no,
      entry_kind: r.entry_kind as TestSeriesEntry["entry_kind"],
      title_i18n: r.tests.title_i18n,
      paper_code: r.tests.paper_code,
      duration_minutes: r.tests.duration_minutes,
      total_marks: r.tests.total_marks,
      question_count: r.tests.test_questions[0]?.count ?? 0,
      opens_at: r.opens_at,
      closes_at: r.closes_at,
      ranked_until: r.ranked_until,
      syllabus_note_i18n: r.syllabus_note_i18n,
      sources_i18n: r.sources_i18n,
      state: entryStateFor(r, a, now),
      attempt_id: a?.id ?? null,
      score: a?.submitted_at ? a.score : null,
      total: a?.submitted_at ? a.total : null,
    };
  });

  return {
    id: s.id,
    slug: s.slug,
    exam_code: s.exam_code,
    stage: s.stage as TestSeriesDetail["stage"],
    paper_scope: s.paper_scope,
    title_i18n: s.title_i18n,
    description_i18n: s.description_i18n,
    status: s.status as TestSeriesDetail["status"],
    starts_on: s.starts_on,
    ends_on: s.ends_on,
    target_exam_year: s.target_exam_year,
    entries: mapped,
  };
}

/** The series entry a test belongs to, or null for an ordinary standalone test. */
export async function seriesEntryForTest(
  testId: string,
): Promise<{ entry: EntryRow; series: SeriesRow } | null> {
  const { data, error } = await supabase()
    .from("test_series_entries")
    .select(`${ENTRY_COLUMNS}, test_series!inner(${SERIES_COLUMNS})`)
    .eq("test_id", testId)
    .maybeSingle();
  if (error) throw new HttpError(500, `series entry lookup failed: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as EntryRow & { test_series: SeriesRow };
  return { entry: row, series: row.test_series };
}

/**
 * The series context for a SUBMITTED attempt — what the result page needs to
 * say which of the two tiers this score belongs to.
 *
 * ⚑ WHY THE PAGE MUST SAY IT RATHER THAN JUST SHOWING NOTHING. The existing
 * rank card reads `v_test_leaderboard`, and migration 0127 makes that view drop
 * a late attempt — so a student who sat the paper a day after the window
 * already gets no card. Silence is ambiguous: it reads as "nobody else took
 * this" or as a bug, when the truth is "this was practice, and here is why".
 * `ranked` is that sentence's data.
 *
 * `rank` is null exactly when `ranked` is false, and `cohort_size` is reported
 * either way — a late attempt is still measured against the cohort for the
 * student's own information, it just does not place in it.
 *
 * Returns null for an attempt on any ordinary standalone test.
 */
export async function attemptSeriesContext(
  attempt: { id: string; test_id: string | null; submitted_at: string | null },
): Promise<AttemptSeriesContext | null> {
  if (!attempt.test_id || !attempt.submitted_at) return null;
  const hit = await seriesEntryForTest(attempt.test_id);
  if (!hit) return null;
  const { entry, series } = hit;

  const ranked = !entry.ranked_until || new Date(attempt.submitted_at) <= new Date(entry.ranked_until);

  const [{ count: entryCount }, board] = await Promise.all([
    supabase().from("test_series_entries").select("id", { count: "exact", head: true }).eq("series_id", series.id),
    supabase().from("v_test_leaderboard").select("attempt_id, score").eq("test_id", attempt.test_id),
  ]);
  if (board.error) throw new HttpError(500, `series board lookup failed: ${board.error.message}`);

  const rows = ((board.data ?? []) as { attempt_id: string; score: number | null }[])
    .map((r) => ({ ...r, score: r.score ?? 0 }))
    .sort((a, b) => b.score - a.score);

  // Competition ranking (1,2,2,4) — the same shape the Scoreboard's own
  // computeRanks produces, so a series rank and a board rank never disagree by
  // a tie-breaking rule.
  let rank: number | null = null;
  const idx = rows.findIndex((r) => r.attempt_id === attempt.id);
  if (ranked && idx !== -1) {
    let r = 1;
    for (let i = 0; i < idx; i++) if (rows[i].score > rows[idx].score) r += 1;
    // Ties share the better rank: count strictly-greater scores, then add 1.
    rank = r;
  }

  return {
    series_slug: series.slug,
    series_title_i18n: series.title_i18n,
    sequence_no: entry.sequence_no,
    entry_count: entryCount ?? 0,
    entry_kind: entry.entry_kind as AttemptSeriesContext["entry_kind"],
    ranked,
    ranked_until: entry.ranked_until,
    rank,
    cohort_size: rows.length,
  };
}

/**
 * THE GATE. Called from `startAttempt` and `startAnswerSession` — a test that is
 * in no series passes straight through, so this is a no-op for every standalone
 * mock, sectional and daily quiz.
 *
 * Both entry points are gated deliberately, even though every series shipped
 * today is Prelims (MCQ) and therefore only reaches `startAttempt`. Leaving the
 * descriptive path ungated would mean a future Mains series silently has no
 * window at all — which is precisely the "one path fixed, sibling missed"
 * pattern this codebase keeps rediscovering.
 */
export async function assertSeriesAttemptAllowed(userId: string, testId: string): Promise<void> {
  const hit = await seriesEntryForTest(testId);
  if (!hit) return;
  const { entry, series } = hit;

  // Access first: a draft series' papers must not be startable by a non-admin
  // even if they somehow learn the test id, and the exam must be the viewer's.
  const examCode = await getUserExam(userId);
  const admin = await isCurrentUserAdmin();
  if (series.exam_code !== examCode) throw notFound("Test not found");
  if (series.status !== "published" && !admin) throw notFound("Test not found");

  // Then the window. 423 Locked rather than 403: the paper exists and this user
  // is entitled to it — it simply has not opened yet, and the client renders a
  // countdown rather than an error.
  if (new Date() < new Date(entry.opens_at)) {
    throw new HttpError(423, `This test opens on ${entry.opens_at}. Tests in a series can be taken late, but never early.`);
  }
  // NO closes_at check, on purpose. Postponement is allowed indefinitely; a late
  // attempt is unranked, which migration 0127's board predicate handles.
}
