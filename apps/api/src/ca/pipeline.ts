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
 * came from. The prompt itself is identical — `triageParams` is called with
 * exactly the same arguments in both paths (see ca/prompts.ts's long note on
 * why that prompt's shape is load-bearing).
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
import { buildCriticParams, parseCritic, QGEN_PROMPT_VERSION } from "../qgen/prompts.js";
import { CandidatePrefilter, PREFILTER_TOP_K, PREFILTER_TOP_K_DEVANAGARI } from "./candidate-prefilter.js";
import { loadSyllabusCandidates } from "./syllabus-candidates.js";
import type {
  CurrentAffairsFact,
  CurrentAffairsMainsBrief,
  CurrentAffairsNodeSignificance,
  CurrentAffairsPossibleQuestions,
} from "@neev/shared";
import { CA_SOURCES } from "./sources.js";
import { getPrelimsCurrentAffairsNodeId } from "./prelims-node.js";
import {
  enrichItem,
  generateMainsQuestion,
  generateMcqs,
  normalizeTriage,
  triageItem,
  triageParams,
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
  type PendingTriagePayload,
} from "./triage-batch-store.js";

/** Items scoring below this on BOTH lives are archived (the hard gate). */
export const RELEVANCE_GATE = 2;

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
}

/** What happened to one triaged item downstream. `duplicate` and `archived` are expected, terminal, and NOT failures. */
export type ProcessOutcome = "persisted" | "archived" | "duplicate" | "insert_failed";

/** Everything `processTriagedItem` needs that isn't the item itself — identical in both modes. */
interface ProcessCtx {
  result: PipelineResult;
  embedTasks: EmbedTask[];
  candidateById: Map<string, SyllabusCandidate>;
  onUsage: (u: LlmUsage) => void;
  log: (msg: string) => void;
}

/** How often the optional `--wait` poll asks whether the just-submitted batch has ended. */
const BATCH_POLL_INTERVAL_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One submitted-but-not-yet-created triage request, held until the claim/submit step. */
interface PendingSubmission {
  customId: string;
  contentHash: string;
  payload: PendingTriagePayload;
  params: BatchRequest["params"];
}

/**
 * Picks the best PRELIMS-paper node (PRE_GS1/PRE_CSAT) out of triage's own
 * `syllabus_node_ids` classification, for placing a CA MCQ on its real topic
 * instead of always pooling it under one "Current Events" node. Triage's
 * candidate pool spans the WHOLE tree (see syllabus-candidates.ts), so it can
 * and does classify a factual item straight onto a prelims node when that's
 * the closest topical match — this just prefers that over the item's
 * mains-paper match (`syllabus_node_ids[0]`, used for the mains brief/question)
 * when one exists. Returns null if triage classified the item to mains-only
 * topics, so the caller can fall back to the pooled node.
 */
function pickPrelimsMcqNode(
  nodeIds: string[],
  candidateById: Map<string, SyllabusCandidate>,
): string | null {
  for (const id of nodeIds) {
    // PRE_GS1 only, not PRE_CSAT — CSAT topics are aptitude/reasoning skills
    // (comprehension, data interpretation, mental ability), never a real
    // current-affairs GK subject, so a CSAT match here would be a genuine
    // mis-mapping rather than a real topic fit. PRE_GS1 is also where the
    // pooled "Current Events" fallback itself lives, so this stays within
    // one paper either way.
    if (candidateById.get(id)?.paperCode === "PRE_GS1") return id;
  }
  return null;
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

async function insertMcqsForItem(opts: {
  syllabusNodeId: string | null;
  title: string;
  facts: string[];
  onUsage: (u: LlmUsage) => void;
}): Promise<string[]> {
  // onUsage MUST be forwarded — without it every CA MCQ generation call was
  // silently missing from the run's reported cost (the mains sibling below
  // has always passed it).
  const mcqs = await generateMcqs({ title: opts.title, facts: opts.facts, onUsage: opts.onUsage });
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
  onUsage: (u: LlmUsage) => void;
}): Promise<string | null> {
  const q = await generateMainsQuestion({ title: opts.title, brief: opts.brief, onUsage: opts.onUsage });

  // Session-11 qgen critic gate — reject anything not exam-worthy.
  const criticJson = await structuredJson({
    ...buildCriticParams({
      node: {
        id: opts.syllabusNodeId ?? "",
        paperCode: CURRENT_AFFAIRS_PAPER_CODE,
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
    // The batch-triage cost for THIS row (r.usage from the succeeded batch
    // entry, if any), billed AT MOST ONCE and only AFTER the row's ledger state
    // has moved to terminal. Called from every terminal branch below (collected
    // and failed) so it fires exactly once on the happy path, but never before
    // the mark commits — billing in bulk at fetch time instead would re-charge
    // every not-yet-settled row on a partial-collect retry, since
    // batches.results() replays the whole batch each time. The residual: a
    // crash in the narrow window BETWEEN a committed mark and this call leaves
    // that one row settled-but-unbilled forever (loadPendingRows never re-sees
    // a terminal row). That's a deliberate at-most-once bias — a sub-cent
    // under-count on a rare crash is the right trade vs. any double-count.
    //
    // The cost is priced as haiku: rr.usage.model comes from
    // fetchBatchResults' `info?.model ?? MODELS.haiku` fallback (info is empty
    // here — record:false), and CA triage IS haiku by construction
    // (triageParams). If triage's model ever changes, persist the model on the
    // ledger row and read it back here, or this silently mis-prices.
    //
    // This is only the batch call's cost; a sync-fallback rescue bills its own
    // (full-price) cost separately via triageItem's onUsage — both really ran.
    const rr = results.get(row.customId);
    const billBatchUsage = async () => {
      if (rr?.usage) {
        ctx.onUsage(rr.usage);
        await recordBatchLlmCall(rr.usage, "ca_triage");
      }
    };

    // The candidate list the model was actually SHOWN, reconstructed from the
    // row's stored candidateIds — validating against the full list would accept
    // node ids the model never saw (backfill.ts makes the same point for its
    // own chunked pre-filter). A node deleted since submission simply drops out.
    // The sync fallback below deliberately reuses this SAME list, so a rescued
    // item is triaged against exactly what the batch request offered it.
    const shown = row.payload.candidateIds
      .map((id) => candidateById.get(id))
      .filter((c): c is SyllabusCandidate => !!c);

    const r = rr;
    let triage: TriageResult | null = null;
    let reason = "";
    if (!r) {
      reason = "no result returned for custom_id";
    } else if (!r.ok) {
      reason = r.error ?? "batch request failed";
    } else {
      try {
        triage = normalizeTriage(JSON.parse(r.text) as TriageResult, shown, row.payload.sourceIsUp);
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
    // see SYNC_FALLBACK_MAX_PER_BATCH for the full reasoning and the cap.
    if (!triage && fallbacksUsed < SYNC_FALLBACK_MAX_PER_BATCH) {
      fallbacksUsed++;
      try {
        triage = await triageItem({
          title: row.payload.title,
          snippet: row.payload.snippet,
          sourceIsUp: row.payload.sourceIsUp,
          candidates: shown,
          onUsage: ctx.onUsage,
        });
        log(
          `[${row.payload.sourceId}] COLLECT: rescued "${row.payload.title.slice(0, 56)}" with a sync retry (${reason})`,
        );
      } catch (err) {
        reason = `${reason}; sync retry also failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (!triage) {
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
        triage,
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

  // Loaded before anything else because BOTH phases need it: collect
  // reconstructs each row's shown-candidate list from it, submit narrows
  // against it.
  const candidates = await loadSyllabusCandidates();
  const candidateById = new Map(candidates.map((c) => [c.id, c]));
  log(`syllabus candidates for mapping: ${candidates.length}`);

  const embedTasks: EmbedTask[] = [];
  const ctx: ProcessCtx = { result, embedTasks, candidateById, onUsage, log };

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

  // Narrows each item's candidate list before triage (~37% less triage input).
  // Fails open to the full list — see ./candidate-prefilter.ts.
  const prefilter = await CandidatePrefilter.create(candidates);
  log(
    `triage candidate pre-filter: ${
      prefilter.enabled
        ? `on (top ${PREFILTER_TOP_K}; ${PREFILTER_TOP_K_DEVANAGARI} for Devanagari items)`
        : "OFF — using full list"
    }`,
  );
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
          // --- 1. Triage ------------------------------------------------------
          const itemCandidates = await prefilter.narrow(title, snippet, (u) => (result.costUsd += u.costUsd));
          const triage = await triageItem({ title, snippet, sourceIsUp: source.isUpSource, candidates: itemCandidates, onUsage });
          seenHashes.add(hash); // never re-triage this link again, kept or archived
          takenFromSource++;
          // --- 2-5. Shared downstream (verbatim the same code the batch-collect
          // path runs — see processTriagedItem). ------------------------------
          await processTriagedItem(
            { link, title, snippet, date: dateStr, sourceId: source.id, hash },
            triage,
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

      // --- Batch mode: build the triage request, spend NOTHING on the model
      // here. `prefilter.narrow` still runs per item (it fails open internally
      // and never throws) because the batch path must send the model EXACTLY
      // what the sync path would have — same triageParams, same arguments.
      // The narrowed ids are persisted with the row so the collector can
      // reconstruct the list the model was actually shown.
      const itemCandidates = await prefilter.narrow(title, snippet, (u) => (result.costUsd += u.costUsd));
      submissions.push({
        // custom_id must match Anthropic's ^[a-zA-Z0-9_-]{1,64}$ — a colon in
        // one has produced a real 400 in this repo before (see the ingest:resolve
        // note in CLAUDE.md). A positional id per batch is the safest form.
        customId: `t_${submissions.length}`,
        contentHash: hash,
        payload: {
          link,
          title,
          snippet,
          date: dateStr,
          sourceId: source.id,
          sourceIsUp: source.isUpSource,
          candidateIds: itemCandidates.map((c) => c.id),
        },
        params: structuredParams(
          triageParams({ title, snippet, sourceIsUp: source.isUpSource, candidates: itemCandidates }),
        ),
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
      const paramsByCustomId = new Map(submissions.map((s) => [s.customId, s.params]));
      const requests: BatchRequest[] = claimed.map((c) => ({
        customId: c.customId,
        params: paramsByCustomId.get(c.customId)!,
        purpose: "ca_triage",
      }));

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
        log(`submitted triage batch ${id} — ${claimed.length} item(s); collectable on a later run`);

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
  triage: TriageResult,
  ctx: ProcessCtx,
): Promise<ProcessOutcome> {
  const { result, embedTasks, candidateById, onUsage, log } = ctx;
  const { link, title, snippet, date: dateStr, sourceId, hash } = item;

  const bestScore = Math.max(triage.prelims_relevance, triage.mains_relevance);
  const hasPrelims = triage.prelims_relevance >= RELEVANCE_GATE;
  const hasMains = triage.mains_relevance >= RELEVANCE_GATE;

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
    embedTasks.push({ itemId, locale: "hi", text: `${enrich.title_i18n.hi}. ${enrich.summary_i18n.hi}` });
    embedTasks.push({ itemId, locale: "en", text: `${enrich.title_i18n.en}. ${enrich.summary_i18n.en}` });
  }

  // --- 5. Dual quiz generation ------------------------------------------
  const nodeId = triage.syllabus_node_ids[0] ?? null;

  // Prelims MCQs — a real factual nugget (prelims_relevance >= 2), published.
  if (hasPrelims && isPublished && prelimsFacts) {
    try {
      const mcqIds = await insertMcqsForItem({
        // CA MCQs are prelims-format and belong in prelims practice. Prefer
        // whichever of triage's OWN classified nodes is a real prelims topic
        // (History/Polity/etc — triage's candidate pool spans every paper, so
        // it does map plainly-factual items straight onto one), so the "+N AI"
        // supply is distributed across topics instead of always landing on one
        // pooled node. Only items triage classified purely against mains-only
        // topics (no prelims match at all) fall back to the pooled "Current
        // Events" node — see ca/prelims-node.ts.
        syllabusNodeId: pickPrelimsMcqNode(triage.syllabus_node_ids, candidateById) ?? (await getPrelimsCurrentAffairsNodeId()),
        title: enrich.title_i18n.en,
        facts: prelimsFacts.map((f) => f.fact_i18n.en),
        onUsage,
      });
      if (mcqIds.length > 0) {
        await supabase().from("current_affairs_items").update({ mcq_question_ids: mcqIds }).eq("id", itemId);
        result.mcqsGenerated += mcqIds.length;
      }
    } catch (err) {
      log(`[${sourceId}] MCQ generation failed for "${title.slice(0, 60)}": ${err instanceof Error ? err.message : err}`);
    }
  }

  // Mains descriptive question — only the richest issues (mains_relevance === 3).
  let mainsQId: string | null = null;
  if (triage.mains_relevance === 3 && isPublished && mainsBrief) {
    try {
      mainsQId = await insertMainsQuestionForItem({
        itemId,
        syllabusNodeId: nodeId,
        title: enrich.title_i18n.en,
        brief: mainsBrief,
        onUsage,
      });
      if (mainsQId) result.mainsQuestionsGenerated++;
    } catch (err) {
      log(`[${sourceId}] Mains question generation failed for "${title.slice(0, 60)}": ${err instanceof Error ? err.message : err}`);
    }
  }

  log(
    `[${sourceId}] KEPT (P${triage.prelims_relevance}/M${triage.mains_relevance}) status=${status} ` +
      `lives=${[hasPrelims ? "prelims" : null, hasMains ? "mains" : null].filter(Boolean).join("+") || "none"} ` +
      `mains_q=${mainsQId ? "yes" : "no"} "${enrich.title_i18n.en.slice(0, 56)}"`,
  );
  return "persisted";
}
