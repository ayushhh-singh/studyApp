/**
 * Structured-JSON schemas + system prompts for the re-engineered current-affairs
 * pipeline (see ./pipeline.ts). Built around exam relevance — every item is
 * TRIAGED (does it have a prelims life? a mains life?), and only surviving items
 * are ENRICHED, filling exactly the lives the triage found.
 *
 *   triageItem     (haiku) — score prelims_relevance + mains_relevance 0-3,
 *                            category, gs_papers, is_up_specific, syllabus nodes.
 *   enrichItem     (haiku) — bilingual title/summary + (conditionally)
 *                            prelims_facts and/or the full mains_brief +
 *                            possible_questions + per-node significance lines.
 *   generateMcqs   (haiku) — prelims practice MCQs (unchanged contract).
 *   generateMainsQuestion (sonnet) — ONE descriptive question for a mains-3 item.
 *
 * All classification/summarization runs on claude-haiku-4-5 (per CLAUDE.md's
 * model split); the single descriptive-question generation runs on sonnet.
 * ToS: the RSS title/snippet is only ever CONTEXT — every persisted string is a
 * fresh own-words paraphrase, never copied source text (enforced in the prompt).
 *
 * NO PROMPT CACHING HERE — DELIBERATE, MEASURED, DO NOT "FIX" (2026-07-22).
 * These are the highest-frequency LLM calls in the codebase (one per RSS item
 * per ca:run), so caching them looks like the obvious win. It isn't:
 *  - enrich (709 tok total), generateMcqs (~100 tok system) and
 *    generateMainsQuestion (~300 tok system) are ALL far below their models'
 *    minimum cacheable prefix — claude-haiku-4-5 needs 4096 tokens before
 *    anything caches at all, sonnet >=1024. Marking a `cache: true` segment
 *    here compiles and ships but caches NOTHING; it only risks paying the
 *    1.25x cache-write premium. Verified with messages.count_tokens.
 *  - triage is 9235 tok, but 8646 of that (94%) is the ~260-node candidate
 *    list; the per-item text is ~90 tok. The list IS invariant per run, but
 *    caching is a prefix match, so it can only be cached by hoisting it ahead
 *    of the item text (into `system`). That layout was built and A/B'd against
 *    this one on 30 real feed items, 3 arms (old/old control + new) to
 *    separate the change from haiku's substantial run-to-run nondeterminism.
 *    Caching worked (98.9% of input served as cache_read), but output quality
 *    regressed ~3x beyond the control's noise on every metric, all downward:
 *    items surviving the relevance gate 14 base / 12 control / 8 new, and
 *    mapped syllabus nodes 37 / 33 / 25. Losing ~a third of kept CA items to
 *    save ~$0.80 on a ~$1 run is a bad trade, so the ordering below (item
 *    text FIRST, candidate list adjacent to it) is load-bearing for quality.
 * If you revisit this, re-run that 3-arm control design — a plain before/after
 * diff cannot distinguish a real regression from haiku's baseline noise here
 * (old-vs-old agreed on only 9/30 items).
 *
 * 2026-07-23 addendum: separately investigated switching to Anthropic's
 * extended (1-hour) cache TTL here — moot, since the above means there is no
 * `cache_control` breakpoint anywhere in this file to switch the TTL of. See
 * CLAUDE.md's "Extended-TTL prompt caching investigated" session note.
 */
import { MODELS, structuredJson, type LlmUsage, type StructuredParams } from "../lib/anthropic.js";
import { getExamConfig, gsPapersFor, requireAuthored, stateLensFor } from "../lib/exam-config.js";
import { fewShotBlock, type FewShotQuestion } from "../qgen/prompts.js";
import type {
  CurrentAffairsCategory,
  CurrentAffairsFact,
  CurrentAffairsGsPaper,
  CurrentAffairsMainsBrief,
  CurrentAffairsPossibleQuestions,
} from "@neev/shared";

/**
 * Every exam-specific string below comes from `lib/exam-config.ts`, unwrapped
 * through `requireAuthored` so an exam whose current-affairs curation lens has
 * not been authored fails LOUDLY at prompt-build time rather than silently
 * triaging another commission's news feed against this one's bar (U6).
 *
 * CACHE BOUNDARY — there ISN'T ONE, and that is deliberate: see the long
 * NO PROMPT CACHING note above. Every call site here passes a PLAIN STRING
 * `system` with no `cache: true` anywhere in the file, so per-exam text is FREE
 * (it partitions nothing because nothing is cached) and no config read can move
 * text across a breakpoint. Do not add a breakpoint to "make the exam text
 * cacheable" — these prompts are all below their models' minimum cacheable
 * prefix, and the ONE block big enough (triage's candidate list) was measured to
 * cost ~a third of kept CA items when reordered to be cacheable.
 *
 * ORDERING IS UNCHANGED BY THIS PARAMETERISATION. Exam strings are substituted
 * strictly IN PLACE: the item text still comes FIRST in `content`, with the
 * candidate list adjacent to it, exactly as the A/B that settled this file's
 * shape required.
 */
function caConfig(examCode: string) {
  return getExamConfig(examCode).ca;
}

const CATEGORIES: CurrentAffairsCategory[] = [
  "polity_governance",
  "economy",
  "international_relations",
  "environment_ecology",
  "science_tech",
  "security",
  "social_issues",
  "art_culture",
  "schemes",
  "reports_indices",
  "places_persons",
  "up_special",
];

// The `gs_papers` enum is PER EXAM — `gsPapersFor(examCode)` in lib/exam-config.ts.
// It used to be one module-level list here offering GS5_UP/GS6_UP (UPPSC's two
// UP-specific Mains papers) to every exam, with a nationally-scoped exam fenced
// off them by `relevanceLens.stateGsPapersNote` alone — prose, i.e. a constraint
// the model may ignore, while the structured-output GRAMMAR said they were legal.
// uppsc's list is byte-for-byte the old one, in the old order, so the live exam's
// triage schema is unchanged (guarded by `pnpm prompts:snapshot`).

const FACT_KINDS: CurrentAffairsFact["kind"][] = [
  "scheme",
  "report_index",
  "place",
  "org",
  "species",
  "appointment",
  "day_theme",
  "misc",
];

const bilingual = {
  type: "object",
  additionalProperties: false,
  properties: { hi: { type: "string" }, en: { type: "string" } },
  required: ["hi", "en"],
} as const;

const bilingualList = {
  type: "object",
  additionalProperties: false,
  properties: {
    hi: { type: "array", items: { type: "string" } },
    en: { type: "array", items: { type: "string" } },
  },
  required: ["hi", "en"],
} as const;

export interface SyllabusCandidate {
  id: string;
  title: string;
  // Not used in the prompt itself (candidateLines below only emits id/title) —
  // lets pipeline.ts pick a PRELIMS match from triage's own classification for
  // MCQ placement without a second model call. Purely additive to this type.
  paperCode: string;
  // Also prompt-invisible: the node's own exam, so the pipeline can record which
  // exams an item actually landed in (and stamp its embedding to match) from the
  // nodes triage chose, rather than leaning on the `{uppsc}` column default.
  examCode: string;
}

// ---------------------------------------------------------------------------
// Triage — the gate. Scores each item's two lives, categorizes, maps nodes.
// ---------------------------------------------------------------------------
export interface TriageResult {
  prelims_relevance: number; // 0-3
  mains_relevance: number; // 0-3
  prelims_reason: string;
  mains_reason: string;
  category: CurrentAffairsCategory;
  gs_papers: CurrentAffairsGsPaper[];
  is_up_specific: boolean;
  syllabus_node_ids: string[];
}

function clamp03(n: unknown): number {
  const v = typeof n === "number" ? Math.round(n) : 0;
  return Math.max(0, Math.min(3, v));
}

/** The StructuredParams for a triage call — shared by the sync path and the batch backfill. */
export function triageParams(opts: {
  title: string;
  snippet: string;
  sourceIsUp: boolean;
  candidates: SyllabusCandidate[];
  /** Whose curation lens + strategist framing to triage against. */
  examCode: string;
}): StructuredParams {
  const { examCode } = opts;
  const cfg = caConfig(examCode);
  const lens = getExamConfig(examCode).relevanceLens;
  const candidateLines = opts.candidates.map((c) => `${c.id}: ${c.title}`).join("\n");
  // `is_up_specific` and the GS5_UP/GS6_UP labels are PERSISTED IDENTIFIERS (a
  // real column on current_affairs_items, and enum values of
  // CurrentAffairsGsPaper). Only the human-readable prose describing them is
  // exam-configurable — never the key or the enum value.
  const stateGsPapersNote = requireAuthored(lens.stateGsPapersNote, examCode, "relevanceLens.stateGsPapersNote");
  const curationDirective = requireAuthored(lens.curationDirective, examCode, "relevanceLens.curationDirective");
  // The "source hints at <state> focus" signal only exists under a STATE lens
  // (it is fed by CA_SOURCES[].isUpSource). A nationally-scoped exam has no
  // state to hint at, so the line is omitted rather than rendered with an empty
  // or borrowed state name. Byte-identical for uppsc, which is state_specific.
  const stateFocusLine =
    lens.kind === "state_specific" ? `Source hints at ${lens.state.nameEn} focus: ${opts.sourceIsUp}\n` : "";
  return {
    model: MODELS.haiku,
    system:
      `You are ${requireAuthored(cfg.strategistFraming, examCode, "ca.strategistFraming")} triaging a news item. Score its TWO independent ` +
      "exam lives, each 0-3:\n" +
      "- prelims_relevance: does it carry a concrete, IDENTIFIABLE fact a prelims MCQ could test — a named scheme, " +
      "report/index (+rank), appointment, place/monument/river/park, organisation/institution, species, book/award, " +
      "day/theme, treaty, or a specific number/first/location? Prelims tests 'what/where/who' identification, so a " +
      "clearly NAMED entity in the news usually rates 2 EVEN IF the story's angle is analytical (e.g. a temple, an " +
      "organisation, a scheme, a report). 0 = no nameable fact (pure opinion/procedure/crime with no examable " +
      "entity); 1 = a fact too generic/ephemeral to test; 2 = a solid, testable named fact; 3 = a high-yield fact " +
      "very likely to be asked.\n" +
      "- mains_relevance: is it an ISSUE worth analysing in a descriptive answer (a policy debate, governance/economy/" +
      "IR/environment/ethics theme with arguments on multiple sides)? 0 = no analytical substance; 1 = thin; 2 = a " +
      "real issue with dimensions; 3 = a rich, debate-worthy issue central to the syllabus.\n" +
      "Be discriminating — routine crime, entertainment, personal-interest, and pure-procedure items score 0-1 on " +
      "BOTH and must be dropped. But MANY genuine current-affairs items carry BOTH a named prelims fact AND an " +
      "analytical mains angle — do not force a single life; score each honestly on its own merits.\n" +
      "Also return: `category` (one fixed value), `gs_papers` (which Mains GS papers the item feeds — [] if mains " +
      `isn't relevant; ${stateGsPapersNote}), \`is_up_specific\` (${curationDirective}), and 0-3 \`syllabus_node_ids\` ` +
      "chosen ONLY from the candidate list by id. Give a ONE-LINE justification for each relevance score.",
    content:
      `Title: ${opts.title}\n` +
      `Snippet: ${opts.snippet}\n` +
      `${stateFocusLine}\n` +
      `Candidate syllabus nodes (id: title):\n${candidateLines}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        prelims_relevance: { type: "integer" },
        mains_relevance: { type: "integer" },
        prelims_reason: { type: "string" },
        mains_reason: { type: "string" },
        category: { type: "string", enum: CATEGORIES },
        // Spread, not the readonly array itself: this object is serialised as the
        // structured-output schema, and the elements (hence the JSON) are identical.
        gs_papers: { type: "array", items: { type: "string", enum: [...gsPapersFor(examCode)] } },
        is_up_specific: { type: "boolean" },
        syllabus_node_ids: { type: "array", items: { type: "string" } },
      },
      required: [
        "prelims_relevance",
        "mains_relevance",
        "prelims_reason",
        "mains_reason",
        "category",
        "gs_papers",
        "is_up_specific",
        "syllabus_node_ids",
      ],
    },
    maxTokens: 1200,
  };
}

/**
 * Normalize/clamp a raw triage JSON against the candidate set. Shared by sync + batch paths.
 *
 * `examCode` is REQUIRED, not defaulted, and validates against THAT exam's own
 * `gs_papers` list — the same list its schema offered. Defaulting it would let a
 * caller silently keep the old cross-exam behaviour (the M24 lesson), and here
 * that means accepting a state paper for a commission that has none: the schema
 * enum is the model's grammar, this filter is the last check before the value is
 * persisted, and the two must be the same set or one of them is decorative.
 */
export function normalizeTriage(
  out: TriageResult,
  candidates: SyllabusCandidate[],
  sourceIsUp: boolean,
  examCode: string,
): TriageResult {
  const validIds = new Set(candidates.map((c) => c.id));
  const allowedPapers = gsPapersFor(examCode);
  // The "source hints at <state> focus" signal is fed by CA_SOURCES[].isUpSource
  // and only EXISTS under a state lens — `triageParams` already omits the line
  // from a nationally-scoped exam's prompt, so OR-ing it back in here would set a
  // flag from a signal that exam was never shown. Inert while uppsc is live
  // (mergeExamTriages ORs across exams anyway), correct when it is not.
  const stateSignal = stateLensFor(examCode) !== null && sourceIsUp;
  return {
    ...out,
    prelims_relevance: clamp03(out.prelims_relevance),
    mains_relevance: clamp03(out.mains_relevance),
    gs_papers: [...new Set((out.gs_papers ?? []).filter((p) => allowedPapers.includes(p)))],
    is_up_specific: out.is_up_specific || stateSignal,
    syllabus_node_ids: (out.syllabus_node_ids ?? []).filter((id) => validIds.has(id)).slice(0, 3),
  };
}

export async function triageItem(opts: {
  title: string;
  snippet: string;
  sourceIsUp: boolean;
  candidates: SyllabusCandidate[];
  examCode: string;
  onUsage?: (u: LlmUsage) => void;
}): Promise<TriageResult> {
  const out = await structuredJson<TriageResult>({
    ...triageParams(opts),
    purpose: "ca_triage",
    // The exam this call was FRAMED as and whose pool it was shown — triage fans
    // out one call per live exam, so each row is attributable to exactly one.
    // Metadata only: `triageParams` builds the prompt and is untouched.
    examCode: opts.examCode,
    onUsage: opts.onUsage,
  });
  return normalizeTriage(out, opts.candidates, opts.sourceIsUp, opts.examCode);
}

// ---------------------------------------------------------------------------
// Enrichment — fills exactly the lives triage found. One call per surviving
// item: always title+summary; prelims_facts iff prelims life; mains_brief iff
// mains life; possible_questions + per-node significance accordingly.
// ---------------------------------------------------------------------------
interface BilingualPair {
  hi: string;
  en: string;
}

export interface NodeSignificanceRow {
  node_id: string;
  prelims_i18n: BilingualPair;
  mains_i18n: BilingualPair;
}

export interface EnrichResult {
  title_i18n: BilingualPair;
  summary_i18n: BilingualPair;
  prelims_facts: CurrentAffairsFact[];
  mains_brief: CurrentAffairsMainsBrief;
  possible_questions: CurrentAffairsPossibleQuestions;
  node_significance: NodeSignificanceRow[];
}

export interface EnrichParamsOpts {
  title: string;
  snippet: string;
  category: string;
  hasPrelimsLife: boolean;
  hasMainsLife: boolean;
  linkedNodes: SyllabusCandidate[];
  /** Whose aspirants this material is written for, and whose exam-worthiness bar applies. */
  examCode: string;
}

/**
 * Cap on how many linked nodes get a node_significance line. triage.ts's
 * normalizeTriage already slices syllabus_node_ids to 3, so in practice every
 * caller already passes ≤3 nodes — this is a belt-and-suspenders bound at the
 * prompt-building layer itself, so a richly-linked item's worst-case output
 * size (and truncation risk) can never grow just because some future caller
 * stops pre-slicing upstream.
 */
const MAX_NODE_SIGNIFICANCE_NODES = 3;

/** The StructuredParams for an enrichment call — shared by the sync path and the batch backfill. */
export function enrichParams(opts: EnrichParamsOpts): StructuredParams {
  const { examCode } = opts;
  const cfg = caConfig(examCode);
  const linkedNodes = opts.linkedNodes.slice(0, MAX_NODE_SIGNIFICANCE_NODES);
  const lives = [
    opts.hasPrelimsLife ? "PRELIMS (fill prelims_facts + possible_questions.prelims_i18n)" : null,
    opts.hasMainsLife ? "MAINS (fill the full mains_brief + possible_questions.mains_i18n)" : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const nodeLines = linkedNodes.length
    ? linkedNodes.map((n) => `${n.id}: ${n.title}`).join("\n")
    : "(none)";

  return {
    model: MODELS.haiku,
    system:
      `You write exam-oriented current-affairs material for ${requireAuthored(cfg.enrichAudience, examCode, "ca.enrichAudience")}, in BOTH Hindi (Devanagari) and English. ` +
      "ALWAYS write in your own words — never copy sentences verbatim from the source title/snippet (that text is " +
      "only context; copying it violates the source's copyright). Be concise, factual, neutral.\n" +
      "GROUNDING — the source title+snippet below is the ONLY evidence you have for WHAT HAPPENED, and every claim " +
      "you make about this item must be supported by it. Rewording it is required; ADDING to it is not allowed. " +
      "(This governs title/summary, every prelims fact, and mains_brief's why_in_news/background/significance/" +
      "challenges/way_forward. It does NOT govern mains_brief's keywords_i18n and case_examples_i18n, which are " +
      "deliberately value-addition material an answer cites — draw those from well-established general knowledge, " +
      "and keep filling them.) Specifically:\n" +
      "  * NEVER introduce a specific the source does not state — a number, count, capacity, date, rank, price, " +
      "statute or section, organisation name, parent institution, job title, place, or classification. If you are " +
      "recalling it rather than reading it in the snippet, it does not go in, even when you believe it is true: an " +
      "unsourced-but-true detail is indistinguishable to a student from an invented one, and both are wrong here.\n" +
      "  * If a fact would only be worth writing WITH a specific the source lacks, write it without that specific or " +
      "SKIP IT. Do not reach for a plausible value to complete the shape of a fact.\n" +
      "  * Keep attribution. If the source says someone claimed, alleged, announced or demanded something, your fact " +
      "must say so too — never restate a claim as an established fact.\n" +
      "  * Do not sharpen a general statement into a precise one (e.g. 'gas' must not become a named gas, 'near a " +
      "port' must not become a named water body, 'several departments' must not become a count).\n" +
      "This item has these active exam lives: fill ONLY those; leave every field of an INACTIVE life empty " +
      "(empty string / empty array).\n" +
      "- title_i18n + summary_i18n: ALWAYS fill (a 1-2 sentence card summary).\n" +
      "- prelims_facts (prelims life): the standalone, memorizable facts a student would revise from this item. Emit " +
      "as many as the item GENUINELY supports (typically 2-6; fewer — even one — is correct when only one fact is " +
      "worth it; NEVER pad to a count). Each has fact_i18n, a `kind` (scheme/report_index/place/org/species/" +
      "appointment/day_theme/misc), and `extras` (fill ministry/publisher/rank/location ONLY when applicable, else " +
      "omit the key). Prefer crisp who/what/when/how-much facts anchored on a NAMED, examinable entity.\n" +
      `  EXAM-WORTHINESS BAR — apply to EVERY fact before writing it: ask '${requireAuthored(cfg.examWorthinessBar, examCode, "ca.examWorthinessBar")}'. A named scheme, report/index (+rank), ` +
      "appointment, place/monument/river/park, organisation, species, treaty, book/award, or day/theme clears the " +
      "bar easily. The `misc` kind is a LAST RESORT held to a MATERIALLY HIGHER bar than every other kind: use it " +
      "ONLY for a genuinely high-yield fact that fits no better kind, NEVER for an incidental detail that merely " +
      "happened to appear in the article — a headcount (e.g. how many students live in a hostel), a date mentioned " +
      "in passing, an unremarkable one-off statistic, or a procedural aside. When a detail would only be a `misc` " +
      "fact of that trivial sort, PREFER TO SKIP IT ENTIRELY — omitting a fact is always better than boxing story " +
      "trivia a real exam would never test.\n" +
      "- mains_brief (mains life): why_in_news_i18n, background_i18n (1-2 lines), and these bilingual arrays (same " +
      "length + order across hi/en): significance_i18n (2-4 points), challenges_i18n (2-4), way_forward_i18n (2-4), " +
      "keywords_i18n (3-6 value-addition phrases/data points an examiner rewards), case_examples_i18n (1-3 concrete " +
      "examples/committees/data an answer can cite).\n" +
      "- possible_questions: a prelims MCQ-style stem (prelims life) and/or a mains directive-verb question (mains " +
      "life). Empty for an inactive life.\n" +
      "- node_significance: for EACH linked syllabus node given below, ONE line per active life explaining why this " +
      "item matters for that node in that exam (prelims_i18n / mains_i18n; empty for an inactive life). Echo the " +
      "node's id exactly.",
    content:
      `Active lives: ${lives || "none"}\n` +
      `Category: ${opts.category}\n` +
      `Title: ${opts.title}\n` +
      `Snippet: ${opts.snippet}\n\n` +
      `Linked syllabus nodes (id: title):\n${nodeLines}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title_i18n: bilingual,
        summary_i18n: bilingual,
        prelims_facts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              fact_i18n: bilingual,
              kind: { type: "string", enum: FACT_KINDS },
              extras: {
                type: "object",
                additionalProperties: false,
                properties: {
                  ministry: { type: "string" },
                  publisher: { type: "string" },
                  rank: { type: "string" },
                  location: { type: "string" },
                },
              },
            },
            required: ["fact_i18n", "kind", "extras"],
          },
        },
        mains_brief: {
          type: "object",
          additionalProperties: false,
          properties: {
            why_in_news_i18n: bilingual,
            background_i18n: bilingual,
            significance_i18n: bilingualList,
            challenges_i18n: bilingualList,
            way_forward_i18n: bilingualList,
            keywords_i18n: bilingualList,
            case_examples_i18n: bilingualList,
          },
          required: [
            "why_in_news_i18n",
            "background_i18n",
            "significance_i18n",
            "challenges_i18n",
            "way_forward_i18n",
            "keywords_i18n",
            "case_examples_i18n",
          ],
        },
        possible_questions: {
          type: "object",
          additionalProperties: false,
          properties: { prelims_i18n: bilingual, mains_i18n: bilingual },
          required: ["prelims_i18n", "mains_i18n"],
        },
        node_significance: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              node_id: { type: "string" },
              prelims_i18n: bilingual,
              mains_i18n: bilingual,
            },
            required: ["node_id", "prelims_i18n", "mains_i18n"],
          },
        },
      },
      required: [
        "title_i18n",
        "summary_i18n",
        "prelims_facts",
        "mains_brief",
        "possible_questions",
        "node_significance",
      ],
    },
    maxTokens: 6000,
  };
}

export async function enrichItem(opts: EnrichParamsOpts & { onUsage?: (u: LlmUsage) => void }): Promise<EnrichResult> {
  return structuredJson<EnrichResult>({
    ...enrichParams(opts),
    purpose: "ca_enrich",
    // Enrichment deliberately does NOT fan out (the item is ONE shared row —
    // see ./exam-fanout.ts), so this is the single framing exam
    // `resolveItemFramingExam` chose: the voice the call was actually paid for.
    examCode: opts.examCode,
    onUsage: opts.onUsage,
  });
}

// ---------------------------------------------------------------------------
// Prelims practice MCQs (unchanged contract — grounded on the item's facts).
// ---------------------------------------------------------------------------
export interface GeneratedMcq {
  stem_i18n: BilingualPair;
  options: { key: string; text_i18n: BilingualPair }[];
  correct_option_key: string;
  explanation_i18n: BilingualPair;
  difficulty: "easy" | "medium" | "hard";
}

/**
 * Prelims practice MCQs for a CA item. `examples` are real published UPPSC PYQs
 * for the item's placed syllabus node (loaded by ca/pipeline.ts via qgen's
 * shared loadFewShot) — few-shotting the generator on genuine exam questions is
 * what gives it a concrete sense of UPPSC style, instead of an abstract "write
 * UPPSC-style" instruction. Returns 0-2 questions: only facts that clear the
 * exam-relevance filter get a question, so a colour-only item yields none.
 */
export interface McqsParamsOpts {
  title: string;
  facts: string[];
  /**
   * Real published UPPSC PYQs to condition style. Optional — the ca:run pipeline
   * passes the placed node's PYQs; the mentor's ephemeral teach-mode quick-check
   * has no node to draw from and passes none, in which case fewShotBlock([])
   * degrades to the generic "follow general UPPSC style" instruction.
   */
  examples?: FewShotQuestion[];
  /** Whose prelims style + exam-relevance filter to write against. */
  examCode: string;
}

/**
 * The StructuredParams for an MCQ-generation call — extracted from
 * generateMcqs() so `pnpm prompts:snapshot` can read the assembled system,
 * content and schema WITHOUT issuing the model call (same pattern as
 * triageParams/enrichParams above). generateMcqs() is now a thin wrapper: the
 * only thing it adds is the purpose/onUsage billing metadata, which is not
 * prompt text.
 */
export function mcqsParams(opts: McqsParamsOpts): StructuredParams {
  const { examCode } = opts;
  const cfg = caConfig(examCode);
  return {
    model: MODELS.haiku,
    system:
      `You write ${requireAuthored(cfg.mcqStyleFraming, examCode, "ca.mcqStyleFraming")} (bilingual, Hindi Devanagari + English) to test a current-affairs ` +
      `item, in the style of ${requireAuthored(cfg.mcqExamplesFraming, examCode, "ca.mcqExamplesFraming")}. Rules:\n` +
      "- Each question has exactly 4 options keyed A/B/C/D, exactly one unambiguously correct, three plausible-but-" +
      "wrong distractors, and a short explanation. Base every question ONLY on the facts given — never invent a fact " +
      "not present in them. Plain text only, no markdown.\n" +
      `- EXAM-RELEVANCE FILTER (the important part): ${requireAuthored(cfg.mcqRelevanceFilter, examCode, "ca.mcqRelevanceFilter")} — a named scheme, report/index (+rank), appointment, place, organisation, species, ` +
      "treaty, award, or a significant first/location. DO NOT build a question around an incidental detail that " +
      "merely appeared in the story (a headcount, a date mentioned in passing, an unremarkable statistic, " +
      "who-said-what) — those are NOT examinable, however factually accurate. Match the difficulty, framing, and " +
      "trap patterns of the real examples below, not a generic quiz.\n" +
      "- QUANTITY IS NOT A TARGET: return 0, 1, or 2 questions — ONLY for facts that clear the filter above. If none " +
      "of the facts is genuinely exam-worthy, return an EMPTY `questions` array. Never pad with a weak question to " +
      "reach a count: one strong question beats two mediocre ones, and zero beats one a real paper would never ask.",
    content:
      `${fewShotBlock(opts.examples ?? [], examCode)}\n\n` +
      `CURRENT-AFFAIRS ITEM TO TEST\nTitle: ${opts.title}\nFacts:\n${opts.facts.map((f) => `- ${f}`).join("\n")}\n\n` +
      `Write 0-2 ${requireAuthored(cfg.mcqOutputLabel, examCode, "ca.mcqOutputLabel")}, ONLY for the exam-worthy facts, in the style of the examples above.`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              stem_i18n: bilingual,
              options: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: { key: { type: "string", enum: ["A", "B", "C", "D"] }, text_i18n: bilingual },
                  required: ["key", "text_i18n"],
                },
              },
              correct_option_key: { type: "string", enum: ["A", "B", "C", "D"] },
              explanation_i18n: bilingual,
              difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
            },
            required: ["stem_i18n", "options", "correct_option_key", "explanation_i18n", "difficulty"],
          },
        },
      },
      required: ["questions"],
    },
    maxTokens: 4000,
  };
}

export async function generateMcqs(
  opts: McqsParamsOpts & { onUsage?: (u: LlmUsage) => void },
): Promise<GeneratedMcq[]> {
  const out = await structuredJson<{ questions: GeneratedMcq[] }>({
    ...mcqsParams(opts),
    purpose: "ca_mcq_gen",
    // The exam this MCQ is GENERATED FOR — the same value stamped on
    // `questions.exam_code`, which for a CURRENT_AFFAIRS row is the OWNER
    // (questionExamScopeFilter's second disjunct), not mere provenance.
    examCode: opts.examCode,
    onUsage: opts.onUsage,
  });
  return out.questions;
}

// The blind-verify confidence check for a generated CA MCQ (same mechanism as
// qgen's Stage C — qgen/prompts.ts's buildVerifyParams/parseVerify) runs
// OUT-OF-BAND on its own cron (ca:verify-mcqs, Message Batches API), not
// inline here — see the comment on ca/pipeline.ts's insertMcqsForItem for why.

// ---------------------------------------------------------------------------
// Mains descriptive question (sonnet) — ONE per mains-3 item, grounded on the
// item's own mains_brief. Runs through the shared qgen critic before insert.
// ---------------------------------------------------------------------------
export interface GeneratedMainsQuestion {
  stem_i18n: BilingualPair;
  marks: number;
  word_limit: number;
  marking_points_i18n: { hi: string[]; en: string[] };
  difficulty: "easy" | "medium" | "hard";
}

export interface MainsQuestionParamsOpts {
  title: string;
  brief: CurrentAffairsMainsBrief;
  /** Whose Mains paper-setting norms to write against. */
  examCode: string;
}

/**
 * The StructuredParams for the CA Mains-question call — extracted from
 * generateMainsQuestion() for the same reason as mcqsParams above: the briefText
 * assembly and the system prompt were local to a function that could only be
 * read by issuing a real sonnet call, so nothing could snapshot-verify them.
 */
export function mainsQuestionParams(opts: MainsQuestionParamsOpts): StructuredParams {
  const { examCode } = opts;
  const cfg = caConfig(examCode);
  const briefText = [
    `Why in news: ${opts.brief.why_in_news_i18n.en}`,
    `Background: ${opts.brief.background_i18n.en}`,
    `Significance: ${opts.brief.significance_i18n.en.join("; ")}`,
    `Challenges: ${opts.brief.challenges_i18n.en.join("; ")}`,
    `Way forward: ${opts.brief.way_forward_i18n.en.join("; ")}`,
  ].join("\n");

  return {
    model: MODELS.sonnet,
    effort: "medium",
    system:
      `You are ${requireAuthored(cfg.mainsSetterFraming, examCode, "ca.mainsSetterFraming")}. Write ONE original, exam-standard DESCRIPTIVE (long-answer) ` +
      "question, in BOTH Hindi (Devanagari) and English, on the current-affairs issue described below. Rules:\n" +
      `- Open with ${requireAuthored(cfg.mainsDirectiveVerbGuidance, examCode, "ca.mainsDirectiveVerbGuidance")} and demand analysis, not recall.\n` +
      `- ${requireAuthored(cfg.mainsMarksNorm, examCode, "ca.mainsMarksNorm")}\n` +
      "- Provide a marking-points outline (4-7 crisp points a strong answer must cover) in BOTH languages, same " +
      "points same order. Ground every factual expectation in the brief or well-established knowledge; never " +
      "fabricate. Hindi and English must be faithful translations. Return strict JSON.",
    content: `Issue: ${opts.title}\n\n${briefText}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        stem_i18n: bilingual,
        marks: { type: "integer" },
        word_limit: { type: "integer" },
        marking_points_i18n: bilingualList,
        difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
      },
      required: ["stem_i18n", "marks", "word_limit", "marking_points_i18n", "difficulty"],
    },
    maxTokens: 3000,
  };
}

export async function generateMainsQuestion(
  opts: MainsQuestionParamsOpts & { onUsage?: Parameters<typeof structuredJson>[0]["onUsage"] },
): Promise<GeneratedMainsQuestion> {
  return structuredJson<GeneratedMainsQuestion>({
    ...mainsQuestionParams(opts),
    purpose: "ca_mains_gen",
    // Same as generateMcqs: the exam this question is generated for and owned by.
    examCode: opts.examCode,
    onUsage: opts.onUsage,
  });
}
