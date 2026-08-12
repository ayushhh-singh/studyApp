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
import { questionExamScopeFilter } from "../lib/exams.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { logger } from "../lib/logger.js";
import { examVisibilityFilter } from "./user-notes.js";

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

interface QuestionRow {
  id: string;
  paper_code: string;
  year: number | null;
  stem_i18n: BilingualText;
  syllabus_node_id: string | null;
  syllabus_nodes: { paper_code: string } | { paper_code: string }[] | null;
}

const searchQuestions: Searcher = {
  examScope:
    "`questionExamScopeFilter` — this exam's syllabus PAPER CODES, plus current-affairs " +
    "questions generated for this exam. NOT `questions.exam_code`, which is PROVENANCE " +
    "(its domain includes up_ro_aro / upsssc_pet, papers deliberately mapped onto the " +
    "default exam's tree that must stay visible). Composed with the catalog visibility " +
    "filter, so a qgen survivor or an unapproved CA MCQ can never surface here.",
  async run(ctx) {
    const { data, error } = await supabase()
      .from("questions")
      .select("id, paper_code, year, stem_i18n, syllabus_node_id, syllabus_nodes(paper_code)")
      // Three stacked `.or()` calls AND together — verified live (33 scoped vs
      // 41 unscoped rows for the same needle), not assumed.
      .or(await questionExamScopeFilter(ctx.examCode))
      .or(questionVisibilityOrFilter("catalog"))
      .or(bilingualIlike("stem_i18n", ctx.like))
      // Recent papers first, matching `listQuestions`' own ordering. `id` breaks
      // ties so the set is stable across identical calls.
      .order("year", { ascending: false })
      .order("id", { ascending: true })
      .limit(ctx.limit);
    if (error) throw new Error(`question search failed: ${error.message}`);

    return ((data ?? []) as unknown as QuestionRow[]).map((r) => {
      // ⚑ The NODE's paper code, never the question's. A current-affairs MCQ has
      // `paper_code = 'CURRENT_AFFAIRS'` — a synthetic code with no syllabus
      // paper behind it — while hanging off a real node in a real paper. Linking
      // with the question's own code would produce `learn/CURRENT_AFFAIRS/<id>`,
      // which 404s.
      const node = Array.isArray(r.syllabus_nodes) ? r.syllabus_nodes[0] : r.syllabus_nodes;
      const nodePaper = node?.paper_code ?? null;
      const to =
        r.syllabus_node_id && nodePaper
          ? `learn/${nodePaper}/${r.syllabus_node_id}?tab=pyqs`
          : // Unmapped question (no node): the archive, filtered to its paper —
            // still a real destination rather than a dead row.
            `pyq-archive?paper=${encodeURIComponent(r.paper_code)}`;
      return {
        type: "question" as const,
        id: r.id,
        // The stem IS the title here — a PYQ has no name. Truncated, because a
        // full Mains stem is a paragraph and would blow out the palette row.
        title: toSnippet(pickLocale(r.stem_i18n, ctx.locale)),
        subtitle: r.year ? `${r.paper_code} · ${r.year}` : r.paper_code,
        to,
      };
    });
  },
};

interface ChapterRow {
  id: string;
  syllabus_node_id: string;
  syllabus_nodes: { paper_code: string; title_i18n: BilingualText } | { paper_code: string; title_i18n: BilingualText }[] | null;
}

const searchChapters: Searcher = {
  examScope:
    "`notes` has NO exam column of its own — it hangs off a syllabus node. Scoped by " +
    "joining `syllabus_nodes!inner(exam_code)` and filtering the EMBEDDED column, which " +
    "is what makes the join an actual filter rather than a decoration. Verified live " +
    "that it bites (uppsc -> MAINS_GS3, upsc -> UPSC_MAINS_GS3 for the same needle).",
  async run(ctx) {
    // ⚑ MATCHES BODY TEXT, NOT THE NODE TITLE. A chapter's name IS its node's
    // title, so title-matching here would return the exact rows the syllabus
    // searcher already returned, pointing at the exact same page — noise, not
    // results. What this adds is the ability to find a chapter that TEACHES a
    // concept no node is named after: overview, the key-facts list, and every
    // section heading (`toc` serialises both locales in one blob, so one
    // condition covers all headings in both languages).
    const l = ctx.like;
    const { data, error } = await supabase()
      .from("notes")
      .select("id, syllabus_node_id, syllabus_nodes!inner(paper_code, title_i18n)")
      .eq("status", "published")
      .eq("syllabus_nodes.exam_code", ctx.examCode)
      .or(
        [
          `content_i18n->en->>overview.ilike.${l}`,
          `content_i18n->hi->>overview.ilike.${l}`,
          `content_i18n->en->>key_facts.ilike.${l}`,
          `content_i18n->hi->>key_facts.ilike.${l}`,
          `study_content_i18n->>toc.ilike.${l}`,
        ].join(","),
      )
      .order("id", { ascending: true })
      .limit(ctx.limit);
    if (error) throw new Error(`chapter search failed: ${error.message}`);

    return ((data ?? []) as unknown as ChapterRow[]).flatMap((r) => {
      const node = Array.isArray(r.syllabus_nodes) ? r.syllabus_nodes[0] : r.syllabus_nodes;
      // `!inner` guarantees a node, but the row shape does not — skip rather
      // than emit a result with no title and a broken link.
      if (!node) return [];
      return [
        {
          type: "chapter" as const,
          id: r.id,
          title: pickLocale(node.title_i18n, ctx.locale),
          subtitle: node.paper_code,
          to: `learn/${node.paper_code}/${r.syllabus_node_id}`,
        },
      ];
    });
  },
};

interface UserNoteRow {
  id: string;
  title: string;
  syllabus_nodes: { paper_code: string } | { paper_code: string }[] | null;
}

const searchUserNotes: Searcher = {
  examScope:
    "`user_notes.exam_code`, via the SAME `examVisibilityFilter` the My-notes list uses — " +
    "imported, not restated, so the two readers cannot drift on what belongs to an exam. " +
    "NULL means 'exam unknown' and stays visible under every exam (0123), never hidden " +
    "under all of them. ⚑ AND, more importantly, `.eq('user_id')`: these are PRIVATE " +
    "rows, so ownership is the primary scope here and exam is only a decluttering one.",
  async run(ctx) {
    const l = ctx.like;
    const { data, error } = await supabase()
      .from("user_notes")
      .select("id, title, syllabus_nodes(paper_code)")
      // ⚑ Ownership first. A missing exam filter shows you another exam's own
      // notes; a missing user filter shows you SOMEONE ELSE'S. Both matter,
      // but only one of them is a privacy breach.
      .eq("user_id", ctx.userId)
      .or(examVisibilityFilter(ctx.examCode))
      // `title` is a plain text column here, not jsonb — a personal note is
      // written in one language and stores no bilingual title.
      .or(
        [
          `title.ilike.${l}`,
          `content_i18n->en->>overview.ilike.${l}`,
          `content_i18n->hi->>overview.ilike.${l}`,
        ].join(","),
      )
      .order("created_at", { ascending: false })
      .limit(ctx.limit);
    if (error) throw new Error(`user note search failed: ${error.message}`);

    return ((data ?? []) as unknown as UserNoteRow[]).map((r) => {
      // A personal note need not be linked to a topic, so this join is NOT
      // `!inner` and the paper code is genuinely optional.
      const node = Array.isArray(r.syllabus_nodes) ? r.syllabus_nodes[0] : r.syllabus_nodes;
      return {
        type: "user_note" as const,
        id: r.id,
        title: r.title,
        subtitle: node?.paper_code ?? null,
        to: `my-notes/${r.id}`,
      };
    });
  },
};

/**
 * ⚑ A `Record`, not a partial map: adding a member to `searchResultTypeSchema`
 * is a compile error until its searcher exists here.
 */
const SEARCHERS: Record<SearchResultType, Searcher> = {
  syllabus: searchSyllabus,
  question: searchQuestions,
  chapter: searchChapters,
  user_note: searchUserNotes,
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
    // Deliberately well above PER_TYPE_LIMIT. Two reasons: it answers "is there
    // more?" without a second COUNT query per type, and it leaves headroom for
    // destination dedupe — a type whose rows collapse heavily (several PYQs on
    // one topic) would otherwise return a nearly-empty group after deduping.
    limit: PER_TYPE_LIMIT * 4 + 1,
  };

  // Every type in parallel — the slowest single query is the response time,
  // rather than the sum. Each is settled independently so ONE failing table
  // cannot blank the whole palette; the caller is told via `degraded`.
  const settled = await Promise.allSettled(
    SEARCH_TYPE_ORDER.map(async (type) => ({ type, results: await SEARCHERS[type].run(ctx) })),
  );

  const groups: SearchGroup[] = [];
  let degraded = false;
  /**
   * ⚑ DEDUPE BY DESTINATION — both ACROSS types and WITHIN one.
   *
   * Two rows that go to the same page are one result to the user, however
   * different they look in the database. Two ways that happens, and a control
   * sweep over 10 real queries found BOTH:
   *
   *  - across types: a chapter has no identity of its own — its name IS its
   *    node's title and it opens the node's page — so a node whose title
   *    matched appeared under two headings pointing at one URL.
   *  - within a type: several PYQs on one topic all link to that topic's
   *    `?tab=pyqs`. Left alone, "panchayat" spent 3 of its 5 question slots on
   *    a single destination. Deduping turns those 5 slots into 5 distinct
   *    topics; the stem shown is still a real matching question, and the page
   *    it opens lists the rest.
   *
   * Keyed on `to`, not on ids: ids differ across tables while the destination is
   * what the user actually experiences as "the same result". It is also
   * self-maintaining — a future type landing on an existing page is deduped for
   * free, and one with a genuinely distinct URL is correctly left alone.
   *
   * First writer wins, so `SEARCH_TYPE_ORDER` decides which framing survives.
   */
  const seenDestinations = new Set<string>();
  for (const [i, outcome] of settled.entries()) {
    const type = SEARCH_TYPE_ORDER[i]!;
    if (outcome.status === "rejected") {
      degraded = true;
      logger.warn({ err: outcome.reason, type, examCode }, "search: one content type failed");
      continue;
    }
    const fetched = outcome.value.results;
    const shown: SearchResult[] = [];
    for (const row of fetched) {
      if (shown.length >= PER_TYPE_LIMIT) break;
      if (seenDestinations.has(row.to)) continue;
      seenDestinations.add(row.to);
      shown.push(row);
    }
    if (shown.length === 0) continue;
    // "There were more matches than these" — true whether the extras were cut
    // by the cap or collapsed by dedupe, which is the question the user is
    // actually asking when they see the marker.
    groups.push({ type, results: shown, has_more: fetched.length > shown.length });
  }

  return {
    query: rawQuery,
    groups,
    total: groups.reduce((n, g) => n + g.results.length, 0),
    degraded,
  };
}
