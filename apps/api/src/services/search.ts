import {
  SEARCH_MIN_QUERY_LENGTH,
  SEARCH_TYPE_ORDER,
  type BilingualText,
  type Locale,
  type SearchGroup,
  type SearchResult,
  type SearchResultType,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { logger } from "../lib/logger.js";

/**
 * CENTRAL SEARCH — one query across every kind of content, for the command
 * palette.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚑ EXAM SCOPING IS THE ENTIRE RISK OF THIS FILE. READ THIS BEFORE ADDING A
 *   SEARCHER.
 * ══════════════════════════════════════════════════════════════════════════
 * Every searcher below MUST restrict its rows to `ctx.examCode`, and every one
 * does it DIFFERENTLY, because each table carries its exam differently:
 *
 *   syllabus_nodes        `exam_code` column
 *   questions             paper codes + CA-generated-for-this-exam
 *                         (`questionExamScopeFilter`) — NOT `questions.exam_code`,
 *                         which is PROVENANCE and includes exams we ingest from
 *                         but never sell
 *   notes (chapters)      no exam column at all — join through
 *                         `syllabus_nodes!inner(exam_code)`
 *   user_notes            `exam_code` column, but NULL means "unknown, show
 *                         under every exam" (0123)
 *   current_affairs_items `exam_codes` ARRAY — `.overlaps`, never equality,
 *                         because one national story is deliberately one row
 *                         shared across several exams (0106 §11)
 *
 * Five tables, five mechanisms, no shared helper that can enforce it — which is
 * exactly how this bug class keeps recurring here. It has shipped repeatedly:
 * `listQuestions` returned a mixed page of 11 UPSC + 9 UPPSC rows to a UPPSC
 * user; `getTodaysQuestion` served another exam's question on ~40% of days;
 * `current_affairs_items.exam_codes` was written by the pipeline and read by
 * nobody for weeks. Search is the worst place to repeat it: it is the ONE
 * surface that queries every table at once, so a single unscoped searcher leaks
 * a second exam's content in response to an entirely innocent word.
 *
 * Two guards, because a comment is not a guard:
 *   1. `Searcher.examScope` is a REQUIRED field. You cannot add a searcher
 *      without writing down how it is scoped, which is the moment you notice
 *      you have not scoped it.
 *   2. `SEARCHERS` is a `Record<SearchResultType, Searcher>`, so adding a
 *      member to the shared enum is a COMPILE ERROR until its searcher exists —
 *      a type cannot be half-added and silently return nothing.
 * Neither can prove a query is *correct*, so both are backed by a live
 * both-directions check (see the session log): for each type, seed/borrow real
 * rows in two exams and assert each user sees only their own.
 */

/** How many results one type contributes before the group says "and more". */
const PER_TYPE_LIMIT = 5;

export interface SearchContext {
  userId: string;
  /** The viewer's PRODUCT exam. Every searcher must filter on this. */
  examCode: string;
  /**
   * The UI locale — used ONLY to choose which side of a bilingual field to
   * display. Matching always covers BOTH locales regardless: an aspirant
   * routinely types an English term while reading the Hindi UI, and vice versa.
   */
  locale: Locale;
  /** `%needle%`, sanitised and ready to interpolate into a PostgREST filter. */
  like: string;
  /** Fetch this many; a searcher asks for one more to detect "has more". */
  limit: number;
}

interface Searcher {
  /**
   * HOW THIS SEARCHER'S ROWS ARE RESTRICTED TO ONE EXAM. Required prose, not
   * decoration: writing it is the step at which an unscoped query becomes
   * obvious. If you cannot name a mechanism, the query is not scoped.
   */
  examScope: string;
  run(ctx: SearchContext): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Query sanitisation
// ---------------------------------------------------------------------------
/**
 * Free text → a PostgREST-safe ilike pattern.
 *
 * `,()` are PostgREST's `.or()` condition separators, so text containing them
 * would be parsed as extra (malformed) conditions — the same neutralisation
 * `services/srs.ts`'s card search performs. They become spaces because in prose
 * they separate words ("GDP (nominal), real").
 *
 * `%`, `*` and `\` are ADDITIONALLY removed, which srs.ts does not do: the
 * first two are ilike wildcards and the third is an escape, so "100%" would
 * otherwise quietly become a wildcard rather than the literal the user typed.
 * They are DELETED rather than spaced, so "100%" still searches "100" (and the
 * surrounding `%…%` still matches the literal "100%" in the text).
 *
 * Returns null when nothing usable survives — `"%%"` would otherwise sanitise
 * to a bare `%%`, which matches EVERY row in every table.
 */
export function toLikePattern(raw: string): string | null {
  const cleaned = raw
    .replace(/[(),]/g, " ")
    .replace(/[%*\\]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (cleaned.length < SEARCH_MIN_QUERY_LENGTH) return null;
  return `%${cleaned}%`;
}

/** `col->>en.ilike.X,col->>hi.ilike.X` — both locales, always. */
function bilingualIlike(column: string, like: string): string {
  return `${column}->>en.ilike.${like},${column}->>hi.ilike.${like}`;
}

/**
 * The requested locale's text, falling back to the other side when it is empty.
 *
 * The fallback is not cosmetic: search matches both locales, so a Hindi-UI user
 * can legitimately match an English-only chapter heading or a PYQ whose Hindi
 * side was never filled. Rendering "" there would show a result with no title.
 */
function pickLocale(value: BilingualText | null | undefined, locale: Locale): string {
  const primary = value?.[locale]?.trim();
  if (primary) return primary;
  return value?.[locale === "en" ? "hi" : "en"]?.trim() ?? "";
}

/** Collapse whitespace and cut to a scannable length for a palette row. */
function toSnippet(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Searchers
// ---------------------------------------------------------------------------
interface SyllabusRow {
  id: string;
  paper_code: string;
  title_i18n: BilingualText;
  description_i18n: BilingualText | null;
}

const searchSyllabus: Searcher = {
  examScope: "`syllabus_nodes.exam_code` — this table carries the exam directly.",
  async run(ctx) {
    const { data, error } = await supabase()
      .from("syllabus_nodes")
      .select("id, paper_code, title_i18n, description_i18n")
      .eq("exam_code", ctx.examCode)
      // depth 0 rows are paper ROOTS, not topics — they are reached through the
      // Learn grid, and listing them here would put "Prelims — General Studies
      // Paper I" above the actual topic someone searched for.
      .gt("depth", 0)
      .or(`${bilingualIlike("title_i18n", ctx.like)},${bilingualIlike("description_i18n", ctx.like)}`)
      // Broader topics first: a depth-1 section is a better landing place than
      // one of its own sub-topics when both match. Deterministic, and `id`
      // breaks ties so paging/ordering never wobbles between identical calls.
      .order("depth", { ascending: true })
      .order("order_index", { ascending: true })
      .order("id", { ascending: true })
      .limit(ctx.limit);
    if (error) throw new Error(`syllabus search failed: ${error.message}`);
    return ((data ?? []) as SyllabusRow[]).map((r) => ({
      type: "syllabus" as const,
      id: r.id,
      title: pickLocale(r.title_i18n, ctx.locale),
      subtitle: r.paper_code,
      to: `learn/${r.paper_code}/${r.id}`,
    }));
  },
};

/**
 * ⚑ A `Record`, not a partial map: adding a member to `searchResultTypeSchema`
 * is a compile error until its searcher exists here.
 */
const SEARCHERS: Record<SearchResultType, Searcher> = {
  syllabus: searchSyllabus,
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
export interface SearchOutcome {
  query: string;
  groups: SearchGroup[];
  total: number;
  degraded: boolean;
}

export async function search(
  userId: string,
  examCode: string,
  rawQuery: string,
  locale: Locale,
): Promise<SearchOutcome> {
  const like = toLikePattern(rawQuery);
  if (!like) return { query: rawQuery, groups: [], total: 0, degraded: false };

  const ctx: SearchContext = {
    userId,
    examCode,
    locale,
    like,
    // One extra row purely to answer "is there more?" without a second COUNT
    // query per type. It is sliced off before the results go out.
    limit: PER_TYPE_LIMIT + 1,
  };

  // Every type in parallel — the slowest single query is the response time,
  // rather than the sum. Each is settled independently so ONE failing table
  // cannot blank the whole palette; the caller is told via `degraded`.
  const settled = await Promise.allSettled(
    SEARCH_TYPE_ORDER.map(async (type) => ({ type, results: await SEARCHERS[type].run(ctx) })),
  );

  const groups: SearchGroup[] = [];
  let degraded = false;
  for (const [i, outcome] of settled.entries()) {
    const type = SEARCH_TYPE_ORDER[i]!;
    if (outcome.status === "rejected") {
      degraded = true;
      logger.warn({ err: outcome.reason, type, examCode }, "search: one content type failed");
      continue;
    }
    const rows = outcome.value.results;
    if (rows.length === 0) continue;
    groups.push({
      type,
      results: rows.slice(0, PER_TYPE_LIMIT),
      has_more: rows.length > PER_TYPE_LIMIT,
    });
  }

  return {
    query: rawQuery,
    groups,
    total: groups.reduce((n, g) => n + g.results.length, 0),
    degraded,
  };
}
