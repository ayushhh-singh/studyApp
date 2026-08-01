/**
 * The multi-exam fan-out for current-affairs triage — the PURE half, so every
 * rule below can be unit-asserted without a database, an LLM call, or a clock.
 *
 * ---------------------------------------------------------------------------
 * WHY A FAN-OUT AND NOT A MERGED POOL
 * ---------------------------------------------------------------------------
 * Until 2026-08-01 the pipeline ran ONE triage call per item against a candidate
 * pool merged across every live exam, framed by `caPromptExamCode(live)` — which
 * returned the single live exam when only one was live and otherwise SILENTLY
 * fell back to `DEFAULT_EXAM_CODE`. With two live exams that is wrong three ways
 * at once, and all three are silent:
 *
 *  1. FRAMING. The prompt would name UPPSC's commission while showing the model a
 *     pool containing another exam's syllabus. Because it FALLS BACK rather than
 *     throwing, `lib/exam-config.ts`'s `UNAUTHORED` guard — the thing that is
 *     supposed to stop an unauthored exam reaching a model — never fires.
 *  2. COVERAGE. The embedding pre-filter keeps a FIXED K (150/220) out of the
 *     pool. Merging two exams' trees does not raise K, so each exam's share of
 *     the shown candidates collapses (measured in `docs/OUTSTANDING.md` §8h U4:
 *     52.8% -> 31.3% of the tree at K=150), with nothing logged.
 *  3. AUTHORSHIP. Everything triage feeds (enrichment, MCQ generation, the mains
 *     descriptive question) would be written to one commission's norms for an
 *     item filed under several.
 *
 * Fanning out fixes all three by construction: each call is byte-identically
 * SHAPED to today's single-exam call — same `triageParams`, same pool semantics,
 * same K — so `ca/prompts.ts` (byte-frozen; its item-text-first ordering is
 * load-bearing and a restructure measurably regressed it) needs no change at all.
 *
 * ⚑ THE N=1 INVARIANT. With exactly one live exam the fan-out MUST collapse to
 * exactly the pre-change path: one triage call per item, over that exam's whole
 * pool, framed as that exam. Every merge rule below is therefore written to be
 * the IDENTITY on a single input — including the ones that only matter for an
 * archived item. That is the UPPSC regression control and it is asserted by the
 * fan-out harness rather than argued.
 *
 * WHAT IS DELIBERATELY *NOT* FANNED OUT: enrichment. A current-affairs item is
 * ONE row shared across exams by design (migration 0106 §11 — one national story
 * maps into several exams' trees precisely so it is not duplicated and its two
 * most expensive LLM calls are not re-paid per exam), and its textual content
 * (`title_i18n`, `summary_i18n`, `prelims_facts`, `mains_brief`) is that one
 * row's content. So enrichment stays ONE call and needs ONE framing exam — see
 * `resolveItemFramingExam`, which makes that choice explicitly and reportably
 * instead of falling back to a default the item may not even be filed under.
 */
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import type { StructuredParams } from "../lib/anthropic.js";
import { getExamConfig } from "../lib/exam-config.js";
import { triageParams, type SyllabusCandidate, type TriageResult } from "./prompts.js";

/**
 * Items scoring below this on BOTH lives are archived (the hard gate).
 *
 * Lives here rather than in `pipeline.ts` because the merge below is defined in
 * terms of it and `pipeline.ts` imports this module (the other direction would
 * be a cycle). `pipeline.ts` re-exports it, so every existing importer is
 * unaffected.
 */
export const RELEVANCE_GATE = 2;

/** One exam's own triage verdict on one item. */
export interface ExamTriage {
  examCode: string;
  triage: TriageResult;
}

/**
 * Why a particular exam's framing was chosen for the item-level prompts.
 * Reported in the run log so the choice is auditable rather than implicit.
 */
export type FramingReason =
  /** Exactly one exam cleared the relevance gate — no judgement needed. */
  | "sole-relevant-exam"
  /** Several cleared it; the one that rated the item highest won. */
  | "highest-relevance"
  /** None cleared it (the item is being archived), so no prompt will run. */
  | "no-relevant-exam";

export interface MergedTriage {
  /** What the shared downstream consumes — deliberately the same `TriageResult` shape. */
  triage: TriageResult;
  /** Exams whose OWN triage cleared the gate. Empty ⇔ the item is archived. */
  relevantExams: string[];
  /** What to stamp on `current_affairs_items.exam_codes` (framing exam first — see below). */
  itemExamCodes: string[];
  /** The ONE exam whose framing the item-level prompts use. */
  framingExamCode: string;
  framingReason: FramingReason;
}

const cleared = (t: TriageResult): boolean =>
  Math.max(t.prelims_relevance, t.mains_relevance) >= RELEVANCE_GATE;

/** How strongly one exam wants the item. Total first so a dual-life 2/2 beats a single 3/0. */
const wantScore = (t: TriageResult): number => t.prelims_relevance + t.mains_relevance;

/**
 * Which exam's framing the ITEM-LEVEL prompts (enrichment) are written to.
 *
 * ⚑ THIS IS THE REPLACEMENT FOR `caPromptExamCode`'s SILENT FALLBACK, and the
 * difference that matters is not the tie-break rule — it is that the answer can
 * no longer be an exam the item is not filed under. The old rule returned
 * `DEFAULT_EXAM_CODE` for anything other than a one-element set, so an item
 * relevant to (say) upsc and mppsc but not uppsc would still have been enriched
 * in UPPSC's voice. Here the answer is always drawn from the exams that actually
 * cleared the gate.
 *
 * DETERMINISTIC BY CONSTRUCTION: highest want-score, then highest single-life
 * score, then the caller's exam order (`Array.prototype.sort` is stable per
 * ES2019, and the caller's order is `liveExamCodes()`, itself ordered by the
 * registry's `sort_order`). The same inputs always pick the same exam, so a
 * re-run of the same item cannot silently re-frame it.
 *
 * The `no-relevant-exam` branch is reachable only on the archive path, where no
 * item-level prompt runs at all; it returns the first exam purely so callers
 * have a non-null value to log.
 */
export function resolveItemFramingExam(
  perExam: readonly ExamTriage[],
  relevant: readonly ExamTriage[],
): { examCode: string; reason: FramingReason } {
  if (relevant.length === 1) return { examCode: relevant[0].examCode, reason: "sole-relevant-exam" };
  if (relevant.length > 1) {
    const best = [...relevant].sort(
      (a, b) =>
        wantScore(b.triage) - wantScore(a.triage) ||
        Math.max(b.triage.prelims_relevance, b.triage.mains_relevance) -
          Math.max(a.triage.prelims_relevance, a.triage.mains_relevance),
    )[0];
    return { examCode: best.examCode, reason: "highest-relevance" };
  }
  return { examCode: perExam[0].examCode, reason: "no-relevant-exam" };
}

/**
 * Fold N per-exam triage verdicts into the ONE `TriageResult` the shared
 * downstream consumes, plus the exam bookkeeping the row needs.
 *
 * EVERY RULE IS THE IDENTITY ON A SINGLE INPUT (the N=1 invariant):
 *  - scores      → MAX across ALL exams. The hard gate reads `max(prelims,
 *                  mains)`, so taking the max here makes "archived" mean exactly
 *                  "no exam wanted it", and keeps `hasPrelims`/`hasMains`
 *                  meaning "has this life for AT LEAST ONE exam" — which is the
 *                  right reading for a row that is deliberately shared.
 *  - reasons     → from whichever exam supplied that max (first, in exam order).
 *  - category    → the framing exam's. It is ONE fixed enum value; there is no
 *                  union that is still a legal value.
 *  - gs_papers   → union. It is already a set, and a nationally-scoped exam is
 *                  instructed never to emit the state-specific labels, so a
 *                  union cannot invent one. (Generalising `gs_papers` /
 *                  `is_up_specific` themselves is M20, deliberately deferred —
 *                  they are entangled with the magazine's section structure.)
 *  - is_up_spec. → OR. It is already an OR with the source hint upstream.
 *  - node ids    → union over the RELEVANT exams, in exam order, deduped. Each
 *                  exam's list is already capped at 3 by `normalizeTriage`, so
 *                  the cap generalises to "up to 3 per exam". When NOTHING
 *                  cleared the gate the union is taken over ALL exams instead,
 *                  so an ARCHIVED row still records what triage saw — without
 *                  that fallback the archive row would lose its node ids at N=1,
 *                  which would break the invariant on a path nobody looks at.
 *
 * `itemExamCodes` is the relevant set; if the item was archived it falls back to
 * the exams owning whatever nodes were mapped, and finally to the default — the
 * same three-step ladder the pre-fan-out code used, just widened.
 *
 * ⚑ `itemExamCodes[0]` IS THE FRAMING EXAM. `current_affairs_items` has no
 * free-form `meta` column and adding one is a migration, so this ordering is how
 * the framing choice is RECORDED ON THE ROW: for a multi-exam item, element 0
 * names the exam whose voice the stored prose was actually written in. Nothing
 * reads this array order-sensitively today (`caEmbeddingExamCode` de-dupes into
 * a Set; the feed filters with `.overlaps`), and Postgres `text[]` preserves
 * order, so this is free. Do not sort it.
 */
export function mergeExamTriages(
  perExam: readonly ExamTriage[],
  candidateById: ReadonlyMap<string, SyllabusCandidate>,
): MergedTriage {
  if (perExam.length === 0) {
    throw new Error("mergeExamTriages: no per-exam triage results (a live exam set can never be empty)");
  }

  const relevant = perExam.filter((e) => cleared(e.triage));
  const relevantExams = relevant.map((e) => e.examCode);

  const prelims = Math.max(...perExam.map((e) => e.triage.prelims_relevance));
  const mains = Math.max(...perExam.map((e) => e.triage.mains_relevance));
  const prelimsSrc = perExam.find((e) => e.triage.prelims_relevance === prelims) ?? perExam[0];
  const mainsSrc = perExam.find((e) => e.triage.mains_relevance === mains) ?? perExam[0];

  const nodeSource = relevant.length > 0 ? relevant : perExam;
  const syllabusNodeIds = [...new Set(nodeSource.flatMap((e) => e.triage.syllabus_node_ids))];

  const framing = resolveItemFramingExam(perExam, relevant);
  const primary = perExam.find((e) => e.examCode === framing.examCode) ?? perExam[0];

  const mappedExams = [
    ...new Set(
      syllabusNodeIds.map((id) => candidateById.get(id)?.examCode).filter((e): e is string => !!e),
    ),
  ];
  const base =
    relevantExams.length > 0 ? relevantExams : mappedExams.length > 0 ? mappedExams : [DEFAULT_EXAM_CODE];
  // Framing exam first, but ONLY when it is genuinely a member — on the archive
  // path the framing exam is a placeholder and must never be injected into a set
  // the item does not belong to.
  const itemExamCodes = base.includes(framing.examCode)
    ? [framing.examCode, ...base.filter((c) => c !== framing.examCode)]
    : base;

  return {
    triage: {
      prelims_relevance: prelims,
      mains_relevance: mains,
      prelims_reason: prelimsSrc.triage.prelims_reason,
      mains_reason: mainsSrc.triage.mains_reason,
      category: primary.triage.category,
      gs_papers: [...new Set(perExam.flatMap((e) => e.triage.gs_papers))],
      is_up_specific: perExam.some((e) => e.triage.is_up_specific),
      syllabus_node_ids: syllabusNodeIds,
    },
    relevantExams,
    itemExamCodes,
    framingExamCode: framing.examCode,
    framingReason: framing.reason,
  };
}

// ---------------------------------------------------------------------------
// Per-exam paper-code predicates (A2) — no more hardcoded "PRE_GS1" /
// startsWith("MAINS_"). Both derive from lib/exam-config.ts's `papers`, which
// references lib/exam-papers.ts / lib/upsc-papers.ts and is never re-typed.
// ---------------------------------------------------------------------------

/** This exam's prelims General Studies paper, or null if its syllabus is not ingested. */
export function prelimsPaperCodeFor(examCode: string): string | null {
  return getExamConfig(examCode).papers.prelimsGs;
}

const mainsCodeCache = new Map<string, ReadonlySet<string>>();

/**
 * Every MAINS-stage paper code of one exam.
 *
 * ⚑ REPLACES `p.startsWith("MAINS_")`, which was not a near-miss — it is FALSE
 * for `UPSC_MAINS_GS1`, because the exam prefix (mandated by M23 for every
 * non-default exam) sits in front of it. A mains current-affairs question for
 * such an exam would therefore have been written with `syllabus_node_id = null`
 * and silently orphaned: every consumer that reads it back filters by
 * `paper_code`, which stays `CURRENT_AFFAIRS` regardless — which is the precise
 * misattribution `pickMainsNode`'s own guard exists to prevent.
 *
 * For `uppsc` this set is {MAINS_GS1..GS6, MAINS_ESSAY, MAINS_GH} — exactly the
 * paper codes `startsWith("MAINS_")` matched, so the behaviour is unchanged.
 */
export function mainsPaperCodesFor(examCode: string): ReadonlySet<string> {
  const hit = mainsCodeCache.get(examCode);
  if (hit) return hit;
  const p = getExamConfig(examCode).papers;
  const set: ReadonlySet<string> = new Set(
    [...p.mainsGs, p.essay, p.generalHindi].filter((c): c is string => !!c),
  );
  mainsCodeCache.set(examCode, set);
  return set;
}

/**
 * First of `nodeIds` (triage's own classification, in the model's preference
 * order) whose paper matches `paperMatches`.
 */
function pickNodeMatching(
  nodeIds: readonly string[],
  candidateById: ReadonlyMap<string, SyllabusCandidate>,
  paperMatches: (paperCode: string) => boolean,
): string | null {
  for (const id of nodeIds) {
    const paperCode = candidateById.get(id)?.paperCode;
    if (paperCode && paperMatches(paperCode)) return id;
  }
  return null;
}

/**
 * Picks a real PRELIMS-paper node out of ONE exam's triage classification, for
 * placing that exam's CA MCQ on its real topic instead of always pooling it
 * under "Current Events". Returns null if triage classified the item to
 * mains-only topics, so the caller can fall back (`classifyPrelimsMcqNode`, then
 * the pooled node — pipeline.ts tries both in order).
 *
 * The exam's prelims GS paper only, never its CSAT paper — CSAT topics are
 * aptitude/reasoning skills (comprehension, data interpretation, mental
 * ability), never a real current-affairs GK subject, so a CSAT match would be a
 * genuine mis-mapping rather than a real topic fit. The pooled "Current Events"
 * fallback lives in that same paper, so this stays within one paper either way.
 */
export function pickPrelimsMcqNode(
  nodeIds: readonly string[],
  candidateById: ReadonlyMap<string, SyllabusCandidate>,
  examCode: string,
): string | null {
  const prelims = prelimsPaperCodeFor(examCode);
  if (!prelims) return null;
  return pickNodeMatching(nodeIds, candidateById, (p) => p === prelims);
}

/**
 * Picks a real MAINS-paper node for ONE exam's mains descriptive question — NOT
 * a blind `syllabus_node_ids[0]`, because triage's candidate pool spans every
 * paper, so the model's first-choice id COULD be a prelims node. That would
 * silently orphan the question (see `mainsPaperCodesFor`). Returns null
 * (unmapped, as before this guard existed) if none of that exam's classified
 * nodes belongs to one of its mains papers.
 */
export function pickMainsNode(
  nodeIds: readonly string[],
  candidateById: ReadonlyMap<string, SyllabusCandidate>,
  examCode: string,
): string | null {
  const mains = mainsPaperCodesFor(examCode);
  return pickNodeMatching(nodeIds, candidateById, (p) => mains.has(p));
}

// ---------------------------------------------------------------------------
// Call planning
// ---------------------------------------------------------------------------

/** One planned triage call: which exam, what the model will be shown, and the exact prompt. */
export interface TriageRequestPlan {
  examCode: string;
  /** The candidate rows the model is actually SHOWN (post pre-filter), in order. */
  candidates: SyllabusCandidate[];
  params: StructuredParams;
}

/**
 * THE one place that decides how many triage calls an item costs and what each
 * one says. Both modes plan through this, so the sync path and the batch path
 * cannot drift — the same reason `processTriagedItem` is shared.
 *
 * Pure: no clock, no network, no DB. That is what lets the N=1 collapse be
 * PROVEN (one request, byte-identical params to the pre-fan-out construction)
 * rather than argued.
 */
export function planTriageRequests(
  item: { title: string; snippet: string; sourceIsUp: boolean },
  perExamCandidates: readonly { examCode: string; candidates: SyllabusCandidate[] }[],
): TriageRequestPlan[] {
  return perExamCandidates.map((scope) => ({
    examCode: scope.examCode,
    candidates: scope.candidates,
    params: triageParams({
      title: item.title,
      snippet: item.snippet,
      sourceIsUp: item.sourceIsUp,
      candidates: scope.candidates,
      examCode: scope.examCode,
    }),
  }));
}

// ---------------------------------------------------------------------------
// The exam-scope write pair — STRUCTURAL, not documented
// ---------------------------------------------------------------------------

/**
 * The two columns that must always be written by the SAME statement.
 *
 * ⚑ WHY THIS EXISTS. Until 2026-08-01 the invariant "a statement that writes
 * `syllabus_node_ids` must also write `exam_codes`" was stated only in comments
 * on three of the four write paths — and the fourth, `pipeline.ts`'s
 * published/draft insert, simply never had the key. It therefore took the column
 * DEFAULT (`array['uppsc']`, migration 0106) on every user-visible row it ever
 * produced, while the archive path beside it wrote the real value. The two paths
 * diverged silently, and nothing could have caught it: the insert succeeded, the
 * row looked well-formed, and the wrong value is a plausible one.
 *
 * That mattered the moment `ca:run --exam <not-live>` became possible: a run
 * targeting an unlaunched exam would have published items authored in that
 * exam's voice, mapped to its syllabus nodes, straight into the DEFAULT exam's
 * live feed.
 */
export const EXAM_SCOPE_COLUMNS = ["syllabus_node_ids", "exam_codes"] as const;
export type ExamScopeColumn = (typeof EXAM_SCOPE_COLUMNS)[number];

/** The pair itself, exactly as it goes onto the row. */
export interface ExamScopeWrite {
  syllabus_node_ids: string[];
  exam_codes: string[];
}

/**
 * Build a `current_affairs_items` insert/update payload whose exam scope comes
 * from the merge and NOWHERE else.
 *
 * ⚑ THIS IS THE ENFORCEMENT, AND IT IS A COMPILE ERROR IN BOTH DIRECTIONS:
 *
 *  - You cannot OMIT `exam_codes`, because you never write it — this function
 *    always does. That is the defect above, made unrepresentable.
 *  - You cannot write EITHER column yourself: `rest` forbids both via
 *    `?: never`, so naming one fails to typecheck with the offending column
 *    named. `?: never` rather than excess-property checking on purpose (the
 *    same reason `ca/widen-exam.ts` uses it) — excess-property checks are
 *    defeated by first assigning the literal to a wider variable; `?: never`
 *    is not, it reduces the whole argument to `never`.
 *
 * So the only way to reach these two columns on this table is through here, and
 * reaching one always carries the other. A new write path added by copying an
 * existing one inherits the guarantee rather than the bug.
 *
 * Pure — no DB, no clock, no model — so it is unit-assertable like the rest of
 * this module. Deliberately takes the whole `MergedTriage` rather than two loose
 * arrays: passing the wrong pair of arrays would typecheck, passing the wrong
 * merge object cannot happen because there is only ever one per item.
 */
export function withExamScope<T extends Record<string, unknown>>(
  merged: Pick<MergedTriage, "triage" | "itemExamCodes">,
  rest: T & { [K in ExamScopeColumn]?: never },
): T & ExamScopeWrite {
  return {
    ...(rest as T),
    syllabus_node_ids: merged.triage.syllabus_node_ids,
    exam_codes: merged.itemExamCodes,
  };
}
