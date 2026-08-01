/**
 * Current-affairs ingestion pipeline, re-engineered around EXAM RELEVANCE.
 *
 * Per item (idempotent across runs via `content_hash` = sha256 of the link):
 *   1. TRIAGE (haiku) — score prelims_relevance + mains_relevance (0-3),
 *      category, gs_papers, is_up_specific, syllabus nodes.
 *   2. HARD GATE — max(prelims, mains) < 2 → store as status='archived' and
 *      STOP (no further LLM spend). This is the "too broad" fix, in code.
 *   3. ENRICH (haiku) — one call filling exactly the lives triage found:
 *      prelims_facts (prelims life) and/or the full mains_brief (mains life),
 *      plus possible_questions + per-node significance lines.
 *   4. Bilingual publish gate (title + summary present in both languages) →
 *      status='published', else 'draft'. Embed published items.
 *   5. DUAL QUIZ — prelims_relevance >= 2 → 2 practice MCQs (review-gated);
 *      mains_relevance === 3 → ONE descriptive question (sonnet + critic),
 *      tagged ca_linked, into the descriptive pool (review-gated).
 *
 * ToS: only the RSS title + short snippet is ever sent to the model as CONTEXT;
 * every persisted string is a fresh own-words paraphrase (enforced in prompts).
 *
 * TWO MODES (2026-07-23). Triage is the highest-frequency LLM call here (one
 * per candidate item, kept AND archived), so it is the one worth moving onto
 * the Message Batches API for its 50% discount. Batches are asynchronous with
 * up to a 24h turnaround, which is incompatible with a cron that must finish
 * inside a workflow timeout — so the pipeline is restructured as SUBMIT-NOW /
 * COLLECT-LATER rather than submit-and-wait:
 *
 *   mode="batch" (default) — each run first COLLECTS any previously-submitted
 *     triage batch that has since ended (running steps 2-5 above for each of
 *     its items), then SUBMITS a fresh batch for this run's new feed items and
 *     exits without waiting. At the 6h cadence an item is live within roughly
 *     one tick. `--wait N` optionally polls the batch just submitted, so a
 *     human running this by hand can still see items land in the same run.
 *   mode="sync" — the original behaviour: one blocking triage call per item,
 *     full price, item live immediately. Kept for interactive/debug runs.
 *
 * Both modes share ONE downstream (`processTriagedItem`), so there is zero
 * behavioural drift between them: the only difference is where the TriageResult
 * came from. The prompt itself is identical — both plan their calls through
 * `planTriageRequests` (see ca/prompts.ts's long note on why that prompt's shape
 * is load-bearing).
 *
 * MULTI-EXAM (2026-08-01). Triage FANS OUT: one call per LIVE exam, each against
 * that exam's OWN candidate pool with that exam's OWN authored framing, merged
 * afterwards by `mergeExamTriages`. Prelims-MCQ and mains-question generation
 * fan out the same way, because a CA question is OWNED by the exam it was
 * generated for (`questionExamScopeFilter`'s second disjunct). Enrichment does
 * NOT fan out — the item is one shared row by design. See ./exam-fanout.ts for
 * the full reasoning, the N=1 invariant, and every merge rule.
 */
import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { supabase } from "../lib/supabase.js";
import { selectAll } from "../lib/paginate.js";
import { embeddings } from "../lib/embeddings.js";
import { i18nComplete } from "../ingest/_shared.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "../lib/question-visibility.js";
import type { BatchRequest, BatchRequestMeta, LlmUsage } from "../lib/anthropic.js";
import {
  batchEnded,
  fetchBatchResults,
  recordBatchLlmCall,
  structuredJson,
  structuredParams,
  submitBatch,
} from "../lib/anthropic.js";
import { MODELS } from "../lib/models.js";
import { loadFewShot, loadNodeContext } from "../qgen/generate.js";
import { buildCriticParams, parseCritic, QGEN_PROMPT_VERSION, type FewShotQuestion } from "../qgen/prompts.js";
import { CandidatePrefilter, PREFILTER_TOP_K, PREFILTER_TOP_K_DEVANAGARI } from "./candidate-prefilter.js";
import { loadSyllabusCandidates } from "./syllabus-candidates.js";
import { caEmbeddingExamCode } from "./embed-exam.js";
import { DEFAULT_EXAM_CODE } from "@neev/shared";
import {
  RELEVANCE_GATE,
  mergeExamTriages,
  pickMainsNode,
  pickPrelimsMcqNode,
  planTriageRequests,
  prelimsPaperCodeFor,
  type ExamTriage,
} from "./exam-fanout.js";
import type {
  CurrentAffairsFact,
  CurrentAffairsMainsBrief,
  CurrentAffairsNodeSignificance,
  CurrentAffairsPossibleQuestions,
} from "@neev/shared";
import { CA_SOURCES } from "./sources.js";
import { getPrelimsCurrentAffairsNodeId } from "./prelims-node.js";
import { classifyPrelimsMcqNode } from "./mcq-node-classify.js";
import {
  enrichItem,
  generateMainsQuestion,
  generateMcqs,
  normalizeTriage,
  triageItem,
  type EnrichResult,
  type SyllabusCandidate,
  type TriageResult,
} from "./prompts.js";
import {
  CLAIM_TTL_MINUTES,
  PENDING_TTL_HOURS,
  claimForSubmission,
  listPendingBatches,
  loadInFlightHashes,
  loadPendingRows,
  markCollected,
  markFailed,
  markSubmitted,
  releaseClaims,
  reapStale,
  type ClaimInput,
  type PendingTriageExamRequest,
  type PendingTriagePayload,
} from "./triage-batch-store.js";

/**
 * Items scoring below this on BOTH lives are archived (the hard gate).
 *
 * Re-exported from ./exam-fanout.ts, where the merge rules that reference it
 * live. Every existing importer (`services/magazine.ts`,
 * `services/current-affairs.ts`, `ca/deepdive.ts`, `ca/backfill.ts`) keeps
 * importing it from here unchanged.
 */
export { RELEVANCE_GATE } from "./exam-fanout.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

interface BilingualPair {
  hi: string;
  en: string;
}

/** A bilingual pair with nothing in either language → null. */
function nullIfEmpty(pair: BilingualPair | null | undefined): BilingualPair | null {
  if (!pair) return null;
  return pair.hi.trim() || pair.en.trim() ? pair : null;
}

/**
 * content_hash of every item seen in the last 60 days — dedupe any realistic
 * re-run window.
 *
 * MUST be paged. This was an unranged select and silently hit PostgREST's
 * 1000-row cap: with 2355 matching rows it returned 1000, so 1355 already-seen
 * items looked NEW on every run and were re-triaged and re-enriched — the two
 * most expensive calls in the pipeline — before the `content_hash` unique index
 * rejected the insert. Wasted spend on every single run, silently, because the
 * truncation surfaces as a plausible-looking count rather than an error.
 */
async function loadRecentHashes(): Promise<Set<string>> {
  const cutoff = istDateString(new Date(Date.now() - 60 * 24 * 3600 * 1000));
  const rows = await selectAll<{ content_hash: string }>(() =>
    supabase()
      .from("current_affairs_items")
      .select("content_hash")
      .gte("date", cutoff)
      .not("content_hash", "is", null)
      .order("content_hash", { ascending: true }), // stable order for paging
  );
  return new Set(rows.map((r) => r.content_hash));
}

export interface PipelineOptions {
  days: number;
  maxPerSource: number;
  maxTotal: number;
  /**
   * WHICH EXAMS THIS RUN BUILDS FOR. REQUIRED, never defaulted — the selection
   * policy belongs to the caller (`resolveTargetExams` in lib/exams.ts), and a
   * default here would be the M24 trap: every caller keeps the old behaviour by
   * doing nothing, so the parameter looks decided while nobody decided it.
   *
   * Normally `liveExamCodes()`. `ca:run --exam <code>` overrides it so content
   * can be built for a not-yet-live exam WITHOUT flipping `exams.is_live`, which
   * would also make that exam selectable by real users (U7).
   */
  examCodes: string[];
  /**
   * "batch" (default) routes triage through the Message Batches API as
   * submit-now/collect-later — half price, but an item goes live on a LATER
   * run. "sync" is the original blocking one-call-per-item path.
   */
  mode?: "batch" | "sync";
  /**
   * Batch mode only: after submitting, poll the new batch for up to this many
   * minutes and collect it in the same run if it ends in time. 0 (the default,
   * and what cron uses) submits and exits immediately.
   */
  collectWaitMinutes?: number;
}

export interface PipelineResult {
  processed: number;
  published: number;
  draft: number;
  archived: number;
  prelimsLife: number;
  mainsLife: number;
  dualLife: number;
  mcqsGenerated: number;
  mainsQuestionsGenerated: number;
  skippedDuplicate: number;
  skippedOld: number;
  skippedNoDate: number;
  cappedTotal: number;
  /** Items that survived the hard gate but threw somewhere in triage/enrich/persist — logged and skipped, never fatal to the run. Left unarchived so a re-run retries them (content_hash isn't recorded on failure). */
  enrichFailed: number;
  costUsd: number;
  sourceFailures: { source: string; error: string }[];
  /** Batch mode: feed items whose triage request was accepted into a Message Batch this run (live on a LATER run). */
  submitted: number;
  /** Batch mode: items whose triage result came back from an ended batch and was run through the downstream this run. */
  collected: number;
  /** Batch mode: pending rows that could not be turned into a persisted item (no/failed batch result, unparseable JSON, downstream insert failure). */
  collectFailed: number;
  /** Batch mode: batches still awaiting collection when this run finished (includes the one it just submitted). */
  batchesPending: number;
}

interface EmbedTask {
  itemId: string;
  locale: "hi" | "en";
  text: string;
  /** Which exam this chunk belongs to; null = shared. See ./embed-exam.ts. */
  examCode: string | null;
}

/** What happened to one triaged item downstream. `duplicate` and `archived` are expected, terminal, and NOT failures. */
export type ProcessOutcome = "persisted" | "archived" | "duplicate" | "insert_failed";

/**
 * One live exam's slice of the run: the pool triage is shown, the pre-filter
 * that narrows it, and the node-placement inputs its generated questions need.
 * Built once per run, per exam.
 */
export interface ExamScope {
  examCode: string;
  /** Every depth-1/2 node of THIS exam — the pool this exam's triage call sees. */
  candidates: SyllabusCandidate[];
  /** Narrows `candidates` per item. One per exam: K is per-pool, not per-run. */
  prefilter: CandidatePrefilter;
  /**
   * This exam's prelims-GS candidates only (never its CSAT paper), excluding its
   * own pooled fallback node — the list `classifyPrelimsMcqNode` chooses from.
   */
  prelimsCandidates: SyllabusCandidate[];
  /** This exam's pooled "Current Events" node, or null if it has none. */
  pooledNodeId: string | null;
}

/** Everything `processTriagedItem` needs that isn't the item itself — identical in both modes. */
interface ProcessCtx {
  result: PipelineResult;
  embedTasks: EmbedTask[];
  /**
   * Every live exam's candidates in ONE map. Node ids are globally unique, so a
   * merged map resolves a node to its own exam's row with no ambiguity — it is
   * only the PROMPT pools that must stay per-exam.
   */
  candidateById: Map<string, SyllabusCandidate>;
  /** One entry per TARGET exam, in `PipelineOptions.examCodes` order. That order is the deterministic tie-break. */
  scopes: ExamScope[];
  onUsage: (u: LlmUsage) => void;
  log: (msg: string) => void;
}

/** This run's per-exam scopes keyed by exam code. */
function scopeFor(ctx: ProcessCtx, examCode: string): ExamScope | undefined {
  return ctx.scopes.find((s) => s.examCode === examCode);
}

/** How often the optional `--wait` poll asks whether the just-submitted batch has ended. */
const BATCH_POLL_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One submitted-but-not-yet-created triage request, held until the claim/submit step. */
interface PendingSubmission {
  /** The LEDGER row's custom_id (one row per item). Not itself an Anthropic request id. */
  customId: string;
  contentHash: string;
  payload: PendingTriagePayload;
  /**
   * One Anthropic request per live exam; ids match `payload.perExam[].customId`.
   * `examCode` rides along so the llm_calls row is attributed to the exam whose
   * pool and framing the request actually carries (migration 0114).
   */
  requests: { customId: string; params: BatchRequest["params"]; examCode: string }[];
}


/** Build the node_significance record, keeping only lines for the item's active lives. */
function buildNodeSignificance(
  enrich: EnrichResult,
  hasPrelims: boolean,
  hasMains: boolean,
): CurrentAffairsNodeSignificance | null {
  const record: CurrentAffairsNodeSignificance = {};
  for (const row of enrich.node_significance ?? []) {
    const prelims = hasPrelims ? nullIfEmpty(row.prelims_i18n) : null;
    const mains = hasMains ? nullIfEmpty(row.mains_i18n) : null;
    if (prelims || mains) record[row.node_id] = { prelims_i18n: prelims, mains_i18n: mains };
  }
  return Object.keys(record).length > 0 ? record : null;
}

/**
 * Real published UPPSC PYQs for the node a CA MCQ will be placed on, to few-shot
 * the generator on genuine exam style (reuses qgen's shared loadFewShot; the CA
 * exclusion in that loader keeps a pooled-node lookup from few-shotting on prior
 * CA output). Best-effort: any lookup failure yields no examples, and
 * fewShotBlock([]) degrades to the generic "follow general UPPSC style" text.
 */
async function loadMcqFewShot(
  nodeId: string,
  log: (msg: string) => void,
): Promise<FewShotQuestion[]> {
  try {
    const node = await loadNodeContext(nodeId);
    return await loadFewShot(node, "mcq");
  } catch (err) {
    log(`few-shot load failed for node ${nodeId}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function insertMcqsForItem(opts: {
  syllabusNodeId: string | null;
  title: string;
  facts: string[];
  /**
   * The exam this MCQ is being GENERATED FOR — whose prelims style it is written
   * in, whose syllabus node it is placed on, and what `questions.exam_code` is
   * stamped with. One call per relevant exam; see processTriagedItem's step 5.
   */
  examCode: string;
  onUsage: (u: LlmUsage) => void;
  log: (msg: string) => void;
}): Promise<string[]> {
  // Few-shot on real PYQs for the placed node (the pooled "Current Events" node
  // when the item has no better topical fit) so the generator writes in genuine
  // UPPSC style. syllabusNodeId is always resolved (never null) by the caller.
  const examples = opts.syllabusNodeId ? await loadMcqFewShot(opts.syllabusNodeId, opts.log) : [];
  // onUsage MUST be forwarded — without it every CA MCQ generation call was
  // silently missing from the run's reported cost (the mains sibling below
  // has always passed it). generateMcqs now returns 0-2 questions (only the
  // exam-worthy facts earn one), so an empty result is the expected outcome for
  // a colour-only item, not a failure — the early return below handles it.
  const mcqs = await generateMcqs({
    title: opts.title,
    facts: opts.facts,
    examples,
    examCode: opts.examCode,
    onUsage: opts.onUsage,
  });
  if (mcqs.length === 0) return [];

  // No inline blind-verify here (deliberately): ca:run is already close to
  // this GitHub Actions job's timeout budget (see ca-run.yml's own comment —
  // it was hard-cancelled mid-run at the previous 15m limit before being
  // raised to 40m), so adding more sequential per-item LLM calls to this hot
  // path risks starving later sources again. generation_meta stays null on
  // insert; the confidence check runs OUT-OF-BAND on its own cron
  // (ca:verify-mcqs, via the cheaper Message Batches API) and picks up every
  // CA MCQ with generation_meta = null, old backlog and freshly generated
  // alike — see ca/verify-mcqs.ts.
  const rows = mcqs.map((q) => ({
    type: "mcq" as const,
    stage: "prelims" as const,
    paper_code: CURRENT_AFFAIRS_PAPER_CODE,
    // ⚑ MUST BE SET EXPLICITLY. `questions.exam_code` defaults to 'uppsc'
    // (migration 0036) and nothing here used to override it, so EVERY CA MCQ was
    // stamped uppsc regardless of which exam it was written for. That is not a
    // cosmetic provenance slip: for a CURRENT_AFFAIRS row `exam_code` is the
    // OWNER, because `questionExamScopeFilter`'s second disjunct is
    // `and(paper_code.eq.CURRENT_AFFAIRS, exam_code.eq.<exam>)`. Left defaulted,
    // a second exam's CA MCQ would be served to UPPSC users (contaminating the
    // live exam) and hidden from the users it was generated for.
    exam_code: opts.examCode,
    syllabus_node_id: opts.syllabusNodeId,
    year: null,
    source: "generated" as const,
    stem_i18n: q.stem_i18n,
    options_i18n: q.options.map((o) => ({ key: o.key, text_i18n: o.text_i18n })),
    correct_option_key: q.correct_option_key,
    explanation_i18n: q.explanation_i18n,
    difficulty: q.difficulty,
    word_limit: null,
    marks: 2,
    // Always review-gated (needs_review, is_published=false) — approving one in
    // the Review Queue publishes it (see lib/question-visibility.ts).
    is_published: false,
    review_state: "needs_review" as const,
  }));

  const { data, error } = await supabase().from("questions").insert(rows).select("id");
  if (error) throw new Error(`CA mcq insert failed: ${error.message}`);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Generate ONE descriptive question for a mains-3 item, grounded on its brief,
 * run it through the shared qgen critic, and insert it (review-gated,
 * tagged ca_linked) if the critic approves. Returns the question id or null.
 */
async function insertMainsQuestionForItem(opts: {
  itemId: string;
  syllabusNodeId: string | null;
  title: string;
  brief: CurrentAffairsMainsBrief;
  /**
   * The exam this question is being GENERATED FOR — whose Mains norms it is
   * written to, whose node it sits on, and what `questions.exam_code` is stamped
   * with (the OWNER for a CURRENT_AFFAIRS row — see insertMcqsForItem).
   */
  examCode: string;
  onUsage: (u: LlmUsage) => void;
}): Promise<string | null> {
  const q = await generateMainsQuestion({
    title: opts.title,
    brief: opts.brief,
    examCode: opts.examCode,
    onUsage: opts.onUsage,
  });

  // Session-11 qgen critic gate — reject anything not exam-worthy.
  const criticJson = await structuredJson({
    ...buildCriticParams({
      node: {
        id: opts.syllabusNodeId ?? "",
        paperCode: CURRENT_AFFAIRS_PAPER_CODE,
        // Synthetic node stub for the critic prompt only — it is never used for
        // retrieval. The exam is the one this question is being generated FOR,
        // so the critic judges it against the commission it was written for
        // rather than against whichever exam happens to be the default.
        examCode: opts.examCode,
        stage: "mains",
        title_i18n: { hi: "", en: opts.title },
        description_i18n: null,
      },
      rendered:
        `Type: Descriptive (Mains)\nQuestion: ${q.stem_i18n.en}\nMarks: ${q.marks} | Word limit: ${q.word_limit}\n` +
        `Marking points:\n${q.marking_points_i18n.en.map((p) => `  - ${p}`).join("\n")}`,
      // CA mains questions aren't node-RAG-grounded; the critic reads the brief
      // it was written from. Pass empty grounding (buildCriticParams handles it).
      grounding: { chunks: [], nodeChunkCount: 0 },
    }),
    purpose: "ca_mains_critic",
    // The critic judges the question against the commission it was written for,
    // so its spend belongs to that same exam — not to whichever exam happens to
    // be the default.
    examCode: opts.examCode,
    onUsage: opts.onUsage,
  });
  const critic = parseCritic(criticJson);
  if (!critic.approve) return null;

  const { data, error } = await supabase()
    .from("questions")
    .insert({
      type: "descriptive",
      stage: "mains",
      paper_code: CURRENT_AFFAIRS_PAPER_CODE,
      // Same reasoning as insertMcqsForItem: for a CURRENT_AFFAIRS row this is
      // the OWNING exam, not mere provenance, and it must never be left to the
      // 'uppsc' column default.
      exam_code: opts.examCode,
      syllabus_node_id: opts.syllabusNodeId,
      year: null,
      source: "generated",
      stem_i18n: q.stem_i18n,
      options_i18n: null,
      correct_option_key: null,
      explanation_i18n: null,
      difficulty: q.difficulty,
      word_limit: q.word_limit,
      marks: q.marks,
      is_published: false,
      review_state: "needs_review",
      generation_meta: {
        ca_linked: true,
        source_item_id: opts.itemId,
        model: MODELS.sonnet,
        prompt_version: QGEN_PROMPT_VERSION,
        marking_points_i18n: q.marking_points_i18n,
        critic,
      },
    })
    .select("id")
    .single();
  if (error) throw new Error(`CA mains question insert failed: ${error.message}`);
  return data.id as string;
}

/**
 * Run steps 2-5 for every item of ONE ended batch, settling each ledger row.
 *
 * EXACTLY-ONCE ARGUMENT. A row is only ever picked up while it is `pending`
 * (loadPendingRows filters on that), and every attempt ends by writing a
 * TERMINAL status — markCollected or markFailed — so no row can be processed
 * twice within a run, and a row can only be retried on a later run if it never
 * reached a terminal state. A crash mid-item therefore leaves the row `pending`
 * and the retry is safe, because the downstream insert is keyed on the unique
 * content_hash: a re-insert of an item that DID land returns 23505, which
 * processTriagedItem reports as "duplicate", and the row is marked collected.
 *
 * ONE ACCEPTED GAP, unchanged from today's behaviour: a crash BETWEEN the item
 * insert and MCQ generation leaves that item without MCQs, because the retry's
 * re-insert short-circuits as a duplicate before reaching step 5. Identical to
 * what happens if the sync path dies at the same point.
 */
/**
 * Per batch, how many unusable results may be rescued with a full-price
 * synchronous retry before we stop and just fail the rest.
 *
 * WHY A FALLBACK EXISTS AT ALL. triageParams caps the response at 1200 tokens.
 * On the sync path `structuredJson` notices stop_reason==="max_tokens" and
 * retries ONCE at ~1.75x, so a verbose triage response recovers. A batch
 * request gets no such retry: the truncated JSON simply fails to parse. Without
 * a fallback the item would be marked failed, re-read from RSS next run,
 * re-submitted against the SAME 1200-token cap, truncate again — and silently
 * age out of the --days freshness window after a few runs. That is a real
 * "item disappears without anyone noticing" path, so the batch mode must not
 * be strictly less robust than the sync mode it replaces. Retrying that single
 * item synchronously reuses structuredJson's own retry logic verbatim.
 *
 * WHY IT IS CAPPED. If a whole batch comes back broken (a bad model id, an API
 * incident), an uncapped fallback would quietly re-run the entire batch at FULL
 * price — turning a cost optimisation into a cost blowup. Past the cap the
 * remaining rows are failed and logged loudly; RSS re-feeds them next run.
 */
const SYNC_FALLBACK_MAX_PER_BATCH = 5;

async function collectBatch(batchId: string, ctx: ProcessCtx): Promise<void> {
  const { result, candidateById, log } = ctx;
  const rows = await loadPendingRows(batchId);
  if (rows.length === 0) return;
  let fallbacksUsed = 0;

  // record:false — read the results WITHOUT billing here. Each row's own
  // batch-triage cost is billed once, below, at the moment that row settles to
  // a terminal state (billBatchUsage). Billing in bulk over the stream instead
  // would re-charge every not-yet-settled row on a partial-collect retry, since
  // batches.results() replays the whole batch every time. `meta` is unused when
  // record:false, so an empty map is passed to say so.
  const results = await fetchBatchResults(batchId, new Map<string, BatchRequestMeta>(), {
    record: false,
  });

  for (const row of rows) {
    // One triage request per LIVE EXAM was submitted for this item, all under
    // the SAME ledger row (the in-flight lock is per content_hash, and an item
    // is submitted or not as a unit). `perExam` carries their custom ids and the
    // exact candidate list each was shown.
    //
    // LEGACY ROWS: a deploy can land while rows submitted by the previous,
    // single-exam build are still pending. Those carry only the flat
    // `candidateIds` and the row's own custom_id, so rehydrate them as a
    // one-exam fan-out attributed to the DEFAULT exam — which is exactly what
    // the old `caPromptExamCode` returned for them. Without this they would be
    // marked failed and re-fed from RSS, i.e. paid for twice.
    const submitted: PendingTriageExamRequest[] = row.payload.perExam?.length
      ? row.payload.perExam
      : [
          {
            examCode: DEFAULT_EXAM_CODE,
            customId: row.customId,
            candidateIds: row.payload.candidateIds ?? [],
          },
        ];

    // The batch-triage cost for THIS row — the sum over its per-exam requests —
    // billed AT MOST ONCE and only AFTER the row's ledger state has moved to
    // terminal. Called from every terminal branch below (collected and failed)
    // so it fires exactly once on the happy path, but never before the mark
    // commits — billing in bulk at fetch time instead would re-charge every
    // not-yet-settled row on a partial-collect retry, since batches.results()
    // replays the whole batch each time. The residual: a crash in the narrow
    // window BETWEEN a committed mark and this call leaves that one row
    // settled-but-unbilled forever (loadPendingRows never re-sees a terminal
    // row). That's a deliberate at-most-once bias — a sub-cent under-count on a
    // rare crash is the right trade vs. any double-count.
    //
    // The cost is priced as haiku: usage.model comes from fetchBatchResults'
    // `info?.model ?? MODELS.haiku` fallback (info is empty here —
    // record:false), and CA triage IS haiku by construction (triageParams). If
    // triage's model ever changes, persist the model on the ledger row and read
    // it back here, or this silently mis-prices.
    //
    // This is only the batch calls' cost; a sync-fallback rescue bills its own
    // (full-price) cost separately via triageItem's onUsage — both really ran.
    const billBatchUsage = async () => {
      for (const req of submitted) {
        const usage = results.get(req.customId)?.usage;
        if (!usage) continue;
        ctx.onUsage(usage);
        // `undefined` userId (cron, no user); `req.examCode` is the exam this
        // request was framed as. For a LEGACY pre-fan-out row that is the
        // DEFAULT exam, which is exactly what the old `caPromptExamCode`
        // returned for it — so the attribution is true, not a guess.
        await recordBatchLlmCall(usage, "ca_triage", undefined, req.examCode);
      }
    };

    const perExam: ExamTriage[] = [];
    const failures: string[] = [];

    for (const req of submitted) {
      // The candidate list THIS exam's call was actually SHOWN, reconstructed
      // from its stored ids — validating against the full list would accept node
      // ids the model never saw (backfill.ts makes the same point for its own
      // chunked pre-filter), and with several exams live it would also accept
      // another exam's nodes outright. A node deleted since submission simply
      // drops out. The sync fallback below deliberately reuses this SAME list,
      // so a rescued item is triaged against exactly what the request offered.
      const shown = req.candidateIds
        .map((id) => candidateById.get(id))
        .filter((c): c is SyllabusCandidate => !!c);

      const rr = results.get(req.customId);
      let triage: TriageResult | null = null;
      let reason = "";
      if (!rr) {
        reason = "no result returned for custom_id";
      } else if (!rr.ok) {
        reason = rr.error ?? "batch request failed";
      } else {
        try {
          triage = normalizeTriage(JSON.parse(rr.text) as TriageResult, shown, row.payload.sourceIsUp, req.examCode);
        } catch (err) {
          // Almost always a response truncated at triageParams' 1200-token cap:
          // JSON.parse on a cut-off fragment throws "Unterminated string", which
          // gives no hint of the real cause (lib/anthropic.ts documents the same
          // trap on the sync path).
          reason = `unusable batch response, likely truncated at the 1200-token cap: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      // Rescue an unusable result with ONE full-price synchronous triage — this
      // is what keeps batch mode from being strictly less robust than sync mode;
      // see SYNC_FALLBACK_MAX_PER_BATCH for the full reasoning and the cap. The
      // budget is per BATCH and counted per REQUEST, so a broken batch cannot be
      // re-run at full price just because several exams are live.
      if (!triage && fallbacksUsed < SYNC_FALLBACK_MAX_PER_BATCH) {
        fallbacksUsed++;
        try {
          triage = await triageItem({
            title: row.payload.title,
            snippet: row.payload.snippet,
            sourceIsUp: row.payload.sourceIsUp,
            candidates: shown,
            examCode: req.examCode,
            onUsage: ctx.onUsage,
          });
          log(
            `[${row.payload.sourceId}] COLLECT: rescued "${row.payload.title.slice(0, 56)}" (${req.examCode}) with a sync retry (${reason})`,
          );
        } catch (err) {
          reason = `${reason}; sync retry also failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      }

      if (triage) perExam.push({ examCode: req.examCode, triage });
      else failures.push(`${req.examCode}: ${reason}`);
    }

    // PARTIAL SUCCESS IS KEPT, NOT DISCARDED. With one exam live this is the
    // same all-or-nothing behaviour as before. With several, failing the whole
    // item because one exam's request truncated would throw away triage we have
    // already paid for — and the item would come back through RSS and be paid
    // for again, for every exam. The surviving exams' verdicts are applied and
    // the missing one is logged; that exam simply does not claim the item.
    if (perExam.length === 0) {
      const reason = failures.join(" | ") || "no triage results";
      await markFailed(row.id, reason);
      await billBatchUsage(); // bill only after the row is terminal (see above)
      result.collectFailed++;
      log(
        `[${row.payload.sourceId}] COLLECT FAILED for "${row.payload.title.slice(0, 60)}": ${reason}` +
          (fallbacksUsed >= SYNC_FALLBACK_MAX_PER_BATCH
            ? ` (sync-retry budget of ${SYNC_FALLBACK_MAX_PER_BATCH} for this batch is spent — remaining failures will be left for RSS to re-feed)`
            : ""),
      );
      continue;
    }
    if (failures.length > 0) {
      log(
        `[${row.payload.sourceId}] COLLECT PARTIAL for "${row.payload.title.slice(0, 56)}" — kept ${perExam
          .map((e) => e.examCode)
          .join("+")}, lost ${failures.join(" | ")}`,
      );
    }

    try {
      const outcome = await processTriagedItem(
        {
          link: row.payload.link,
          title: row.payload.title,
          snippet: row.payload.snippet,
          date: row.payload.date,
          sourceId: row.payload.sourceId,
          hash: row.contentHash,
        },
        perExam,
        ctx,
      );
      if (outcome === "insert_failed") {
        // A non-23505 DB error: terminal for this row (the triage spend is
        // already sunk and un-repeatable), surfaced as a collect failure.
        await markFailed(row.id, "downstream insert failed");
        await billBatchUsage();
        result.collectFailed++;
      } else {
        await markCollected(row.id);
        await billBatchUsage();
        result.collected++;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed(row.id, message);
      await billBatchUsage();
      result.collectFailed++;
      log(`[${row.payload.sourceId}] COLLECT FAILED for "${row.payload.title.slice(0, 64)}": ${message}`);
    }
  }
}

/** Collect every pending batch that has ended; log (and skip) the ones still cooking. */
async function collectPendingBatches(ctx: ProcessCtx): Promise<void> {
  const { log } = ctx;
  const pending = await listPendingBatches();
  if (pending.length === 0) return;
  log(`pending triage batches: ${pending.length}`);
  for (const { batchId, submittedAt, count } of pending) {
    try {
      if (!(await batchEnded(batchId))) {
        log(`batch ${batchId} still processing (${count} items, submitted ${submittedAt})`);
        continue;
      }
      await collectBatch(batchId, ctx);
    } catch (err) {
      // One unreachable/broken batch must not abort the run — the rest of the
      // pending batches, and this run's own submission, still go through.
      const message = err instanceof Error ? err.message : String(err);
      ctx.result.sourceFailures.push({ source: "triage-batch", error: `collect ${batchId}: ${message}` });
      log(`COLLECT FAILED for batch ${batchId}: ${message}`);
    }
  }
}

export async function runPipeline(
  opts: PipelineOptions,
  log: (msg: string) => void = () => {},
): Promise<PipelineResult> {
  const mode = opts.mode ?? "batch";
  const collectWaitMinutes = opts.collectWaitMinutes ?? 0;
  const parser = new Parser({ timeout: 20_000 });
  const result: PipelineResult = {
    processed: 0,
    published: 0,
    draft: 0,
    archived: 0,
    prelimsLife: 0,
    mainsLife: 0,
    dualLife: 0,
    mcqsGenerated: 0,
    mainsQuestionsGenerated: 0,
    skippedDuplicate: 0,
    skippedOld: 0,
    skippedNoDate: 0,
    cappedTotal: 0,
    enrichFailed: 0,
    costUsd: 0,
    sourceFailures: [],
    submitted: 0,
    collected: 0,
    collectFailed: 0,
    batchesPending: 0,
  };
  const onUsage = (u: LlmUsage) => (result.costUsd += u.costUsd);

  // ONE SCOPE PER TARGET EXAM (normally the live set — see
  // `PipelineOptions.examCodes`). Built before anything else because BOTH phases
  // need them: collect reconstructs each row's shown-candidate list from the
  // merged map, submit narrows against each exam's own pool.
  //
  // ⚑ THE POOLS ARE PER EXAM, NOT MERGED. A merged pool would keep the
  // pre-filter's FIXED K (150/220) while doubling the tree, silently halving
  // each exam's candidate coverage — measured at 52.8% -> 31.3% (see
  // ./exam-fanout.ts). One pool per exam keeps K per-exam, so coverage is
  // unchanged however many exams are live. With ONE live exam this is exactly
  // the previous single pool, single pre-filter, single triage call.
  const live = opts.examCodes;
  const scopes: ExamScope[] = [];
  for (const examCode of live) {
    const candidates = await loadSyllabusCandidates({ examCodes: [examCode] });
    const prefilter = await CandidatePrefilter.create(candidates);
    const pooledNodeId = await getPrelimsCurrentAffairsNodeId(examCode);
    const prelimsPaper = prelimsPaperCodeFor(examCode);
    scopes.push({
      examCode,
      candidates,
      prefilter,
      // This exam's prelims-GS candidates only (never its CSAT paper), minus its
      // own pooled fallback node. Empty when the exam has no prelims paper yet,
      // which short-circuits classifyPrelimsMcqNode rather than borrowing
      // another exam's curriculum.
      prelimsCandidates: prelimsPaper
        ? candidates.filter((c) => c.paperCode === prelimsPaper && c.id !== pooledNodeId)
        : [],
      pooledNodeId,
    });
    log(
      `[${examCode}] syllabus candidates for mapping: ${candidates.length}; ` +
        `triage candidate pre-filter: ${
          prefilter.enabled
            ? `on (top ${PREFILTER_TOP_K}; ${PREFILTER_TOP_K_DEVANAGARI} for Devanagari items)`
            : "OFF — using full list"
        }`,
    );
  }
  if (scopes.length === 0) throw new Error("ca:run: no target exams — nothing to triage against");
  if (scopes.length > 1) {
    log(
      `MULTI-EXAM RUN: triage fans out to ${scopes.length} exams (${live.join(", ")}) — ` +
        `${scopes.length} triage calls per item, one per exam, each against its own pool`,
    );
  }
  // Node ids are globally unique, so ONE merged map resolves any node to its own
  // exam's row. Only the prompt pools have to stay separate.
  const candidateById = new Map(scopes.flatMap((s) => s.candidates).map((c) => [c.id, c]));

  const embedTasks: EmbedTask[] = [];
  const ctx: ProcessCtx = { result, embedTasks, candidateById, scopes, onUsage, log };

  // -------------------------------------------------------------------------
  // REAP + COLLECT FIRST, in BOTH modes. The ordering is load-bearing:
  // collecting persists items into current_affairs_items, so their content_hash
  // is present BEFORE loadRecentHashes() runs below — otherwise this run would
  // re-read those same links from RSS, see them as new, and pay for them again.
  //
  // Runs in sync mode too on purpose: `--mode sync` never SUBMITS, but a batch
  // left pending by an earlier batch-mode run still needs draining. If collect
  // were batch-only, an operator who switched to sync would strand that batch
  // until PENDING_TTL_HOURS reaped it to failed (a 26h delay + a wasted, paid
  // batch). Collecting is pure downside-free work in any mode — it only applies
  // results that were already bought — so it always runs.
  {
    const reaped = await reapStale();
    if (reaped.releasedClaims > 0) {
      // A claim with no batch id means a process died between claiming and
      // submitting — worth saying loudly rather than burying in a tally.
      log(
        `reaped ${reaped.releasedClaims} orphaned claim(s) older than ${CLAIM_TTL_MINUTES}m — a previous run died mid-submit; those items will be re-fed from RSS`,
      );
    }
    if (reaped.failedStale > 0 || reaped.pruned > 0) {
      log(`reaper: failed ${reaped.failedStale} stale row(s) (>${PENDING_TTL_HOURS}h), pruned ${reaped.pruned} settled row(s)`);
    }
    await collectPendingBatches(ctx);
  }

  const seenHashes = await loadRecentHashes();
  log(`known items in the last 60 days: ${seenHashes.size}`);
  // THE IN-FLIGHT UNION is what stops an item that is sitting in an
  // un-collected batch from being processed (and paid for) a second time: it
  // has no current_affairs_items row yet, so loadRecentHashes cannot know about
  // it — only the ledger can.
  //
  // UNCONDITIONAL, including in sync mode, on purpose. `--mode sync` is an
  // operator escape hatch that may well be run WHILE a batch from an earlier
  // run is still uncollected; without this union that run would re-triage those
  // items synchronously at full price, and the later collect would then throw
  // its (already paid for) batch result away as a 23505 duplicate. Skipping
  // them instead costs nothing — they are already bought and will land when
  // their batch is collected.
  {
    const inFlight = await loadInFlightHashes();
    if (inFlight.size > 0 || mode === "batch") {
      for (const h of inFlight) seenHashes.add(h);
      log(`in flight (submitted, not yet collected): ${inFlight.size}`);
    }
  }

  /** Batch-mode triage requests built this run, submitted in one go at the end. */
  const submissions: PendingSubmission[] = [];
  /**
   * What --max-total bounds. Sync mode keeps the historical meaning exactly
   * (items KEPT — an archived item never counted). Batch mode cannot know yet
   * which items will survive the gate, so it bounds items SUBMITTED, which is
   * the cost-relevant number there (every submitted item is a paid triage
   * call) and also keeps `collected` items from eating this run's submit
   * budget.
   */
  const totalTaken = () => (mode === "batch" ? submissions.length : result.processed);

  for (const source of CA_SOURCES) {
    if (totalTaken() >= opts.maxTotal) {
      result.cappedTotal++;
      continue;
    }
    let feed;
    try {
      feed = await parser.parseURL(source.feedUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.sourceFailures.push({ source: source.id, error: message });
      log(`[${source.id}] FEED FETCH FAILED: ${message}`);
      continue;
    }

    let takenFromSource = 0;
    for (const item of feed.items ?? []) {
      if (totalTaken() >= opts.maxTotal) {
        result.cappedTotal++;
        break;
      }
      if (takenFromSource >= opts.maxPerSource) break;

      const link = item.link ?? item.guid;
      const title = (item.title ?? "").trim();
      if (!link || !title) continue;

      const hash = sha256(link);
      if (seenHashes.has(hash)) {
        result.skippedDuplicate++;
        continue;
      }

      const rawDate = item.isoDate ?? item.pubDate;
      const pubDate = rawDate ? new Date(rawDate) : null;
      if (!pubDate || Number.isNaN(pubDate.getTime())) {
        result.skippedNoDate++;
        continue;
      }
      const ageDays = (Date.now() - pubDate.getTime()) / (24 * 3600 * 1000);
      if (ageDays > opts.days) {
        result.skippedOld++;
        continue;
      }

      const snippet = (item.contentSnippet ?? item.content ?? "").slice(0, 1200);
      const dateStr = istDateString(pubDate);

      // ONE PLAN PER LIVE EXAM, built the same way in both modes — the narrowing
      // is per exam because the pre-filter is per exam. `prefilter.narrow` fails
      // open internally and never throws.
      const plans = planTriageRequests(
        { title, snippet, sourceIsUp: source.isUpSource },
        await Promise.all(
          scopes.map(async (scope) => ({
            examCode: scope.examCode,
            candidates: await scope.prefilter.narrow(title, snippet, (u) => (result.costUsd += u.costUsd)),
          })),
        ),
      );

      if (mode === "sync") {
        // The whole triage→enrich→persist sequence for ONE item is isolated
        // here: any failure (a truncated LLM response, a transient network
        // error, an unexpected schema mismatch) is caught, logged, and counted
        // in result.enrichFailed rather than aborting the rest of the run. The
        // item's content_hash is only added to seenHashes on a successful
        // triage (below), and it's never persisted to current_affairs_items on
        // failure, so a failed item is naturally retried on the next run
        // rather than being silently dropped forever.
        try {
          // --- 1. Triage, once per live exam ---------------------------------
          // `triageItem` rebuilds the prompt from the same `triageParams` and the
          // same arguments the plan carries, so this sends byte-identically what
          // the batch path submits — they cannot drift.
          const perExam: ExamTriage[] = [];
          for (const plan of plans) {
            perExam.push({
              examCode: plan.examCode,
              triage: await triageItem({
                title,
                snippet,
                sourceIsUp: source.isUpSource,
                candidates: plan.candidates,
                examCode: plan.examCode,
                onUsage,
              }),
            });
          }
          seenHashes.add(hash); // never re-triage this link again, kept or archived
          takenFromSource++;
          // --- 2-5. Shared downstream (verbatim the same code the batch-collect
          // path runs — see processTriagedItem). ------------------------------
          await processTriagedItem(
            { link, title, snippet, date: dateStr, sourceId: source.id, hash },
            perExam,
            ctx,
          );
        } catch (err) {
          result.enrichFailed++;
          const message = err instanceof Error ? err.message : String(err);
          log(`[${source.id}] ITEM FAILED, skipping (left for retry next run) — "${title.slice(0, 64)}": ${message}`);
          continue;
        }
        continue;
      }

      // --- Batch mode: build the triage requests, spend NOTHING on the model
      // here. One request per live exam, all under ONE ledger row (the in-flight
      // lock is per content_hash and an item is submitted or not as a unit). The
      // narrowed ids are persisted per exam so the collector can reconstruct the
      // list each call was actually shown.
      //
      // custom_id must match Anthropic's ^[a-zA-Z0-9_-]{1,64}$ — a colon in one
      // has produced a real 400 in this repo before (see the ingest:resolve note
      // in CLAUDE.md). A positional id per batch is the safest form; the `_e<i>`
      // suffix keeps the per-exam ids unique and still inside that character set.
      const baseCustomId = `t_${submissions.length}`;
      submissions.push({
        customId: baseCustomId,
        contentHash: hash,
        payload: {
          link,
          title,
          snippet,
          date: dateStr,
          sourceId: source.id,
          sourceIsUp: source.isUpSource,
          perExam: plans.map((plan, i) => ({
            examCode: plan.examCode,
            customId: `${baseCustomId}_e${i}`,
            candidateIds: plan.candidates.map((c) => c.id),
          })),
        },
        requests: plans.map((plan, i) => ({
          customId: `${baseCustomId}_e${i}`,
          params: structuredParams(plan.params),
          examCode: plan.examCode,
        })),
      });
      // Mirrors the sync path exactly: the hash is banked so the same link is
      // never queued twice within a run, and the per-source cap advances.
      seenHashes.add(hash);
      takenFromSource++;
    }
  }

  // -------------------------------------------------------------------------
  // SUBMIT — claim, then create, then mark. THE ORDER IS LOAD-BEARING; see the
  // per-step comments for what each ordering protects against.
  // -------------------------------------------------------------------------
  if (mode === "batch" && submissions.length > 0) {
    // 1. CLAIM FIRST, before a single token is spent. Claiming takes the
    //    per-content_hash in-flight lock, so a concurrent run (or the next
    //    scheduled tick, if this one overruns) cannot queue the same link a
    //    second time. It may claim FEWER rows than asked for — whatever it
    //    lost the race on simply isn't ours to submit.
    const claimInputs: ClaimInput[] = submissions.map((s) => ({
      customId: s.customId,
      contentHash: s.contentHash,
      payload: s.payload,
    }));
    const claimed = await claimForSubmission(claimInputs);
    if (claimed.length < submissions.length) {
      log(
        `claimed ${claimed.length}/${submissions.length} triage row(s) — the rest are already in flight from another run`,
      );
    }

    if (claimed.length === 0) {
      log("nothing to submit — every candidate item is already in flight");
    } else {
      // One ledger row FANS OUT to one Anthropic request per live exam. Only the
      // rows we actually claimed are submitted, so an item lost to the in-flight
      // race contributes none of its per-exam requests.
      const requestsByRowCustomId = new Map(submissions.map((s) => [s.customId, s.requests]));
      const requests: BatchRequest[] = claimed.flatMap((c) =>
        (requestsByRowCustomId.get(c.customId) ?? []).map((r) => ({
          customId: r.customId,
          params: r.params,
          purpose: "ca_triage" as const,
          examCode: r.examCode,
        })),
      );

      let batchId: string | null = null;
      try {
        batchId = await submitBatch(requests);
      } catch (err) {
        // 2. A FAILED CREATE MUST RELEASE ITS CLAIMS. Left claimed, those links
        //    are invisible to a re-feed (loadInFlightHashes excludes them) until
        //    the claim TTL expires — i.e. silently dropped for hours for work
        //    that was never even submitted. Released, they are just re-read from
        //    RSS on the next run.
        await releaseClaims(claimed.map((c) => c.rowId));
        const message = err instanceof Error ? err.message : String(err);
        result.sourceFailures.push({ source: "triage-batch", error: message });
        // Logged + recorded as a failure rather than rethrown: anything this
        // run already COLLECTED is persisted and still needs its embeddings
        // flushed below, and run.ts surfaces sourceFailures loudly.
        log(`TRIAGE BATCH SUBMIT FAILED — released ${claimed.length} claim(s) for retry next run: ${message}`);
      }

      if (batchId) {
        const id = batchId;
        // 3. RECORD THE BATCH ID on the claimed rows. A crash in the window
        //    between submitBatch() returning and markSubmitted() completing
        //    leaves claimed rows carrying no batch id; reapStale() deletes
        //    those after CLAIM_TTL_MINUTES, so their items are re-fed from RSS
        //    next run. The worst case is paying once for an orphaned batch
        //    nobody ever collects — never data loss.
        await markSubmitted(claimed.map((c) => c.rowId), id);
        result.submitted = claimed.length;
        log(
          `submitted triage batch ${id} — ${claimed.length} item(s) as ${requests.length} request(s)` +
            `${scopes.length > 1 ? ` (${scopes.length} exams)` : ""}; collectable on a later run`,
        );

        // Optional same-run collection: a human running `pnpm ca:run --wait 20`
        // still sees items land in this run. Cron leaves this at 0 and exits.
        if (collectWaitMinutes > 0) {
          const deadline = Date.now() + collectWaitMinutes * 60_000;
          log(`waiting up to ${collectWaitMinutes}m for batch ${id} to end...`);
          let ended = await batchEnded(id);
          while (!ended && Date.now() < deadline) {
            await sleep(Math.min(BATCH_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
            ended = await batchEnded(id);
          }
          if (ended) {
            await collectBatch(id, ctx);
          } else {
            log(`batch ${id} still processing after ${collectWaitMinutes}m — it will be collected on a later run`);
          }
        }
      }
    }
  }

  // Covers BOTH the items collected at the top of this run and anything
  // collected in the optional wait above (plus every sync-mode item).
  if (embedTasks.length > 0) {
    const provider = embeddings();
    const batchSize = 96;
    for (let i = 0; i < embedTasks.length; i += batchSize) {
      const batch = embedTasks.slice(i, i + batchSize);
      const vectors = await provider.embed(batch.map((t) => t.text), (u) => (result.costUsd += u.costUsd));
      const rows = batch.map((t, j) => ({
        source_type: "current_affairs" as const,
        source_id: t.itemId,
        locale: t.locale,
        chunk_text: t.text,
        embedding: toVectorLiteral(vectors[j]),
        exam_code: t.examCode,
      }));
      const { error } = await supabase()
        .from("embeddings")
        .upsert(rows, { onConflict: "source_type,source_id,locale,chunk_index" });
      if (error) log(`embeddings upsert failed for batch starting ${i}: ${error.message}`);
    }
    log(`embedded ${embedTasks.length} chunks`);
  }

  // Recounted at the end (both modes — sync can leave batches pending too if it
  // collected some but not all) rather than tallied during collect, so the
  // number means exactly "batches still awaiting collection when this run
  // finished" — it includes the one just submitted and excludes any fully
  // collected.
  result.batchesPending = (await listPendingBatches()).length;
  if (result.batchesPending > 0) log(`batches awaiting collection: ${result.batchesPending}`);

  return result;
}

/**
 * Steps 2-5 for ONE already-triaged item: hard gate → enrich → publish-gate
 * insert → dual quiz generation → embed tasks. Shared VERBATIM by the sync path
 * and the batch-collect path so the two modes cannot drift.
 *
 * Never throws for an expected DB conflict (23505 on content_hash); returns the
 * outcome so a batch collector can settle its ledger row. Genuine failures
 * (LLM/network/schema) still throw — the sync caller counts those in
 * enrichFailed, the collect caller in collectFailed.
 */
export async function processTriagedItem(
  item: { link: string; title: string; snippet: string; date: string; sourceId: string; hash: string },
  perExamTriage: readonly ExamTriage[],
  ctx: ProcessCtx,
): Promise<ProcessOutcome> {
  const { result, embedTasks, candidateById, onUsage, log } = ctx;
  const { link, title, snippet, date: dateStr, sourceId, hash } = item;

  // Fold every live exam's verdict into the one TriageResult this function has
  // always consumed, plus the exam bookkeeping. Every merge rule is the identity
  // on a single input — see ./exam-fanout.ts.
  const merged = mergeExamTriages(perExamTriage, candidateById);
  const triage = merged.triage;
  const { relevantExams, itemExamCodes } = merged;

  const bestScore = Math.max(triage.prelims_relevance, triage.mains_relevance);
  const hasPrelims = triage.prelims_relevance >= RELEVANCE_GATE;
  const hasMains = triage.mains_relevance >= RELEVANCE_GATE;

  // The ONE exam the item-level prompt (enrichment) is framed against. Chosen
  // EXPLICITLY from the exams that actually cleared the gate — never a silent
  // fallback to the default, which could have framed an item in the voice of an
  // exam it is not even filed under. Recorded on the row as `exam_codes[0]` and
  // logged below, so a multi-exam item's authorship is auditable after the fact.
  const itemExamCode = merged.framingExamCode;
  if (perExamTriage.length > 1) {
    log(
      `[${sourceId}] FRAMING ${itemExamCode} (${merged.framingReason}) for "${title.slice(0, 48)}" — ` +
        `relevant: ${relevantExams.join("+") || "none"}; scores ` +
        perExamTriage.map((e) => `${e.examCode} P${e.triage.prelims_relevance}/M${e.triage.mains_relevance}`).join(", "),
    );
  }

  // --- 2. Hard gate -----------------------------------------------------
  if (bestScore < RELEVANCE_GATE) {
    const { error: archiveError } = await supabase()
      .from("current_affairs_items")
      .insert({
        date: dateStr,
        status: "archived",
        category: triage.category,
        is_up_specific: triage.is_up_specific,
        prelims_relevance: triage.prelims_relevance,
        mains_relevance: triage.mains_relevance,
        gs_papers: triage.gs_papers,
        title_i18n: { hi: "", en: title },
        syllabus_node_ids: triage.syllabus_node_ids,
        exam_codes: itemExamCodes,
        mcq_question_ids: [],
        content_hash: hash,
        source_id: sourceId,
        source_urls: [link],
      });
    if (archiveError) {
      // 23505 = unique_violation on content_hash. loadRecentHashes() only
      // looks back 60 days by the ITEM's own article date, but the
      // content_hash unique index has no such time bound — a source that
      // bumps an old article's pubDate (a republish/edit) makes it look
      // "new" (passes the freshness gate on its fresh pubDate) even
      // though its permanent content_hash row is already there from
      // months ago. Not a real duplicate LLM call to worry about below
      // (we already paid for triage before finding this out) — just
      // don't miscount it as a fresh archive.
      if (archiveError.code === "23505") {
        result.skippedDuplicate++;
        log(`[${sourceId}] already known (republished) — "${title.slice(0, 60)}"`);
        return "duplicate";
      }
      log(`[${sourceId}] ARCHIVE INSERT FAILED for "${title.slice(0, 60)}": ${archiveError.message}`);
      return "insert_failed";
    }
    result.archived++;
    log(
      `[${sourceId}] ARCHIVED (P${triage.prelims_relevance}/M${triage.mains_relevance}) "${title.slice(0, 64)}" — ${triage.prelims_reason} | ${triage.mains_reason}`,
    );
    return "archived";
  }

  // --- 3. Enrich (only the active lives) --------------------------------
  const linkedNodes = triage.syllabus_node_ids
    .map((id) => candidateById.get(id))
    .filter((n): n is SyllabusCandidate => !!n);
  const enrich = await enrichItem({
    title,
    snippet,
    category: triage.category,
    hasPrelimsLife: hasPrelims,
    hasMainsLife: hasMains,
    linkedNodes,
    examCode: itemExamCode,
    onUsage,
  });

  const prelimsFacts: CurrentAffairsFact[] | null =
    hasPrelims && enrich.prelims_facts.length > 0 ? enrich.prelims_facts : null;
  const mainsBrief: CurrentAffairsMainsBrief | null =
    hasMains && enrich.mains_brief.why_in_news_i18n.en.trim() ? enrich.mains_brief : null;
  const possibleQuestions: CurrentAffairsPossibleQuestions = {
    prelims_i18n: hasPrelims ? nullIfEmpty(enrich.possible_questions.prelims_i18n) : null,
    mains_i18n: hasMains ? nullIfEmpty(enrich.possible_questions.mains_i18n) : null,
  };
  const nodeSignificance = buildNodeSignificance(enrich, hasPrelims, hasMains);

  // --- 4. Publish gate + insert -----------------------------------------
  const isPublished = i18nComplete(enrich.title_i18n) && i18nComplete(enrich.summary_i18n);
  const status = isPublished ? "published" : "draft";

  const { data: row, error: insertError } = await supabase()
    .from("current_affairs_items")
    .insert({
      date: dateStr,
      status,
      category: triage.category,
      is_up_specific: triage.is_up_specific,
      prelims_relevance: triage.prelims_relevance,
      mains_relevance: triage.mains_relevance,
      gs_papers: triage.gs_papers,
      title_i18n: enrich.title_i18n,
      summary_i18n: enrich.summary_i18n,
      prelims_facts: prelimsFacts,
      mains_brief: mainsBrief,
      possible_questions: possibleQuestions,
      node_significance: nodeSignificance,
      source_urls: [link],
      syllabus_node_ids: triage.syllabus_node_ids,
      mcq_question_ids: [],
      content_hash: hash,
      source_id: sourceId,
    })
    .select("id")
    .single();
  if (insertError) {
    // See the archive-path comment above: 23505 here is the same
    // republished-article/content_hash situation, just discovered after
    // we'd already paid for the (more expensive) enrich call too.
    if (insertError.code === "23505") {
      result.skippedDuplicate++;
      log(`[${sourceId}] already known (republished) — "${title.slice(0, 60)}"`);
      return "duplicate";
    }
    log(`[${sourceId}] INSERT FAILED for "${title.slice(0, 60)}": ${insertError.message}`);
    return "insert_failed";
  }

  const itemId = row.id as string;
  result.processed++;
  if (isPublished) result.published++;
  else result.draft++;
  if (hasPrelims) result.prelimsLife++;
  if (hasMains) result.mainsLife++;
  if (hasPrelims && hasMains) result.dualLife++;

  if (isPublished) {
    const embedExam = caEmbeddingExamCode(itemExamCodes);
    embedTasks.push({ itemId, locale: "hi", text: `${enrich.title_i18n.hi}. ${enrich.summary_i18n.hi}`, examCode: embedExam });
    embedTasks.push({ itemId, locale: "en", text: `${enrich.title_i18n.en}. ${enrich.summary_i18n.en}`, examCode: embedExam });
  }

  // --- 5. Dual quiz generation, PER RELEVANT EXAM -----------------------------
  // ⚑ QUESTIONS ARE EXAM-OWNED, WHICH IS WHY THIS FANS OUT WHERE ENRICHMENT DOES
  // NOT. `questionExamScopeFilter` admits a CURRENT_AFFAIRS question for exactly
  // ONE exam — `and(paper_code.eq.CURRENT_AFFAIRS, exam_code.eq.<exam>)` — so a
  // single generated question can only ever reach one exam's users. Generating
  // one set for a "primary" exam would therefore silently give the other exams'
  // users nothing at all, while also placing the question on whichever exam's
  // syllabus node happened to be picked. One set per relevant exam, each on that
  // exam's own node, in that exam's own style, is the only shape that is correct
  // for every exam the item is filed under.
  //
  // COST: with one live exam this is exactly one MCQ call and (for a mains-3
  // item) one question + critic, as before. With N live exams relevant to the
  // same item it is N of each — the deliberate, disclosed price of each exam
  // getting real questions rather than none.
  const mcqIds: string[] = [];
  let mainsQCount = 0;

  for (const examCode of relevantExams) {
    const scope = scopeFor(ctx, examCode);
    // A relevant exam always has a scope (relevantExams comes from this run's own
    // scopes), but a defensive skip beats a crash mid-item.
    if (!scope) continue;
    const examNodeIds = perExamTriage.find((e) => e.examCode === examCode)?.triage.syllabus_node_ids ?? [];

    // Prelims MCQs — a real factual nugget (prelims_relevance >= 2), published.
    if (hasPrelims && isPublished && prelimsFacts) {
      try {
        const factsEn = prelimsFacts.map((f) => f.fact_i18n.en);
        // Two-tier node placement, cheapest-first:
        // (1) THIS EXAM'S triage classification incidentally includes a real
        //     prelims-GS topic (History/Polity/etc) — free, no extra call, but
        //     measured to fire for only ~1-in-50 items (triage is framed around
        //     mains themes, so it rarely reaches for a prelims-shaped node even
        //     though its candidate pool spans every paper).
        // (2) a dedicated, narrow classification asking the ONE question that
        //     matters for MCQ placement — given the exact facts this MCQ was
        //     written from, which prelims topic (if any) fits — the same
        //     prompt validated live against 585 historical items via
        //     scripts/ca-reclassify-mcq-nodes.ts. This is what actually keeps
        //     new MCQs distributed going forward, since (1) alone leaves most
        //     items pooled purely by how rarely it fires, not by any flaw.
        // Only items with no real prelims-topic fit under EITHER tier fall
        // back to that exam's pooled "Current Events" node (ca/prelims-node.ts).
        // Every tier is scoped to THIS exam, so an MCQ can never land on another
        // exam's node.
        const prelimsNodeId =
          pickPrelimsMcqNode(examNodeIds, candidateById, examCode) ??
          (await classifyPrelimsMcqNode({
            title: enrich.title_i18n.en,
            facts: factsEn,
            prelimsCandidates: scope.prelimsCandidates,
            // The exam that OWNS the candidate list — which is now, by
            // construction, the same exam the MCQ is being written for.
            examCode,
            onUsage,
          }));
        const ids = await insertMcqsForItem({
          syllabusNodeId: prelimsNodeId ?? scope.pooledNodeId,
          title: enrich.title_i18n.en,
          facts: factsEn,
          examCode,
          onUsage,
          log,
        });
        mcqIds.push(...ids);
        result.mcqsGenerated += ids.length;
      } catch (err) {
        log(
          `[${sourceId}] MCQ generation failed (${examCode}) for "${title.slice(0, 60)}": ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    // Mains descriptive question — only the richest issues (mains_relevance === 3).
    // Gated on THIS exam's own mains score, not the merged max: an exam that
    // rated the item 2 should not get a question the merge only justified for a
    // sibling exam. `pickMainsNode` uses that exam's own paper codes, so
    // `UPSC_MAINS_GS1` is recognised where `startsWith("MAINS_")` failed it.
    const examMains = perExamTriage.find((e) => e.examCode === examCode)?.triage.mains_relevance ?? 0;
    if (examMains === 3 && isPublished && mainsBrief) {
      try {
        const mainsQId = await insertMainsQuestionForItem({
          itemId,
          syllabusNodeId: pickMainsNode(examNodeIds, candidateById, examCode),
          title: enrich.title_i18n.en,
          brief: mainsBrief,
          examCode,
          onUsage,
        });
        if (mainsQId) {
          mainsQCount++;
          result.mainsQuestionsGenerated++;
        }
      } catch (err) {
        log(
          `[${sourceId}] Mains question generation failed (${examCode}) for "${title.slice(0, 60)}": ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  if (mcqIds.length > 0) {
    // ONE update with every exam's MCQ ids — `mcq_question_ids` is the item's
    // full generated set across exams, matching `exam_codes` being an array.
    await supabase().from("current_affairs_items").update({ mcq_question_ids: mcqIds }).eq("id", itemId);
  }

  log(
    `[${sourceId}] KEPT (P${triage.prelims_relevance}/M${triage.mains_relevance}) status=${status} ` +
      `exams=${itemExamCodes.join("+")} ` +
      `lives=${[hasPrelims ? "prelims" : null, hasMains ? "mains" : null].filter(Boolean).join("+") || "none"} ` +
      `mains_q=${mainsQCount > 0 ? mainsQCount : "no"} "${enrich.title_i18n.en.slice(0, 56)}"`,
  );
  return "persisted";
}
