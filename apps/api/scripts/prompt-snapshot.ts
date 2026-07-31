/**
 * BYTE-IDENTITY HARNESS for every LLM prompt string the API builds.
 *
 * WHY THIS EXISTS
 * ---------------
 * The prompt text in this codebase hardcodes "UPPSC" (and UP-specific framing)
 * in dozens of places. Parameterising that behind a per-exam config module must
 * leave every existing `uppsc` prompt BYTE-IDENTICAL — a refactor that silently
 * reflows a sentence, drops a space, or moves a system segment across a cache
 * breakpoint is a real regression that no typecheck catches and that a live
 * model run cannot reliably detect (haiku/sonnet output is nondeterministic; see
 * CLAUDE.md's CA prompt-caching A/B notes). So this harness proves equivalence
 * BY STRING DIFF IN CODE and NEVER calls a model, hits the network, or reads the
 * database.
 *
 * USAGE
 *   pnpm prompts:snapshot            # DIFF against the committed baseline; exit 1 on any change
 *   pnpm prompts:snapshot --write    # (re)write the baseline
 *
 * DETERMINISM CONTRACT (do not break this)
 *   - Fixtures are fixed inline literals. No Date.now(), no Math.random(), no
 *     env-dependent values, no DB reads, no clock, no filesystem input.
 *   - Running twice on an unchanged tree MUST produce a byte-identical file.
 *
 * FIXTURE CONVENTION
 *   Fixture strings deliberately avoid the token "UPPSC". Any occurrence of
 *   "UPPSC" in a snapshot value therefore comes from the PROMPT TEMPLATE itself,
 *   never from the data — which makes this file double as a locator for the
 *   refactor: grep the baseline for "UPPSC" to enumerate exactly which assembled
 *   prompts carry the hardcoded exam name.
 *
 * SNAPSHOT VALUE SHAPES
 *   - a plain string           for a builder that returns a string
 *   - { segments: [{ text, cache }], content, schema, model, ... }
 *                              for a builder returning shared StructuredParams,
 *                              so SEGMENT BOUNDARIES and CACHE FLAGS are part of
 *                              what must not regress (moving text across a
 *                              `cache: true` breakpoint changes cache behaviour
 *                              and billing even when the concatenation matches)
 *   - a JSON object            for a model-visible JSON Schema
 *
 * COVERAGE LIMIT — READ BEFORE TRUSTING A GREEN RUN
 *   Several prompts are NOT reachable without editing their source file (a
 *   module-private const, or a template literal written inline as the `system:`/
 *   `content:` property of the very `structuredJson(...)`/`streamText(...)` call
 *   that issues the model request). Those are enumerated verbatim under the
 *   `__not_reachable_without_editing__` key in the baseline. This harness CANNOT
 *   auto-verify them; the refactor must verify them another way (a manual diff
 *   of the file's own hunk, or by exporting the builder as part of the refactor
 *   and adding it here in the SAME commit).
 */

// ---------------------------------------------------------------------------
// Placeholder env FIRST, before any module is loaded.
//
// Both lib/supabase.ts and lib/anthropic.ts are lazy singletons (they throw
// inside the accessor, not at module scope), so today no prompt module actually
// crashes on import without env. This is defensive: it keeps the harness
// runnable on a machine with no .env at all, and stops a future top-level client
// construction from turning a prompt diff into an import crash. The values are
// syntactically valid but obviously fake, and NOTHING here ever makes a call.
// ---------------------------------------------------------------------------
process.env.SUPABASE_URL ||= "https://prompt-snapshot.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "prompt-snapshot-fake-service-role-key";
process.env.SUPABASE_ANON_KEY ||= "prompt-snapshot-fake-anon-key";
process.env.ANTHROPIC_API_KEY ||= "sk-ant-prompt-snapshot-fake";
process.env.OPENAI_API_KEY ||= "sk-prompt-snapshot-fake";
process.env.NODE_ENV ||= "test";

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Portable paths only — resolved from this module's own location, never a
// hardcoded prefix or an assumed process.cwd() (see CLAUDE.md → Dev conventions).
const SNAPSHOT_DIR = join(import.meta.dirname, "__snapshots__");
const SNAPSHOT_FILE = join(SNAPSHOT_DIR, "prompts.baseline.json");

type Snapshot = Record<string, unknown>;

const snapshot: Snapshot = {};
/** Modules that failed to import — recorded so a silent gap is impossible. */
const unreachable: Record<string, string> = {};

function put(key: string, value: unknown): void {
  if (key in snapshot) throw new Error(`Duplicate snapshot key: ${key}`);
  snapshot[key] = value;
}

/**
 * Normalise a shared `StructuredParams` into a diff-stable object. Segment
 * boundaries and cache flags are captured explicitly, and `systemKind` records
 * whether the system was a bare string or a segment array — lib/anthropic.ts's
 * toSystemParam passes a string straight through but maps an array to
 * TextBlockParam[], so string-vs-[{text}] is a real wire-format difference even
 * when the text matches.
 */
function paramsSnapshot(p: {
  model: string;
  system?: string | { text: string; cache?: boolean }[];
  content: unknown;
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: string;
}): Record<string, unknown> {
  const sys = p.system;
  const segments =
    typeof sys === "string"
      ? [{ text: sys, cache: false }]
      : Array.isArray(sys)
        ? sys.map((s) => ({ text: s.text, cache: s.cache === true }))
        : [];
  return {
    model: p.model,
    effort: p.effort ?? null,
    maxTokens: p.maxTokens ?? null,
    systemKind: typeof sys === "string" ? "string" : Array.isArray(sys) ? "segments" : "none",
    segments,
    content: typeof p.content === "string" ? p.content : JSON.stringify(p.content),
    schema: p.schema,
  };
}

/**
 * Normalise an already-assembled Anthropic `MessageCreateParamsNonStreaming`
 * (what audit/resolve.ts and audit/consistency.ts's pure builders return) into
 * the same diff-stable shape as paramsSnapshot(). These builders wrap
 * structuredParams(), so their system prompt and rendered user content are
 * readable with ZERO network calls — which is why the otherwise module-private
 * SOLVE_SYSTEM / ARGUED_SYSTEM are covered here after all.
 */
function messageParamsSnapshot(p: {
  model: string;
  system?: unknown;
  messages: { role: string; content: unknown }[];
  max_tokens: number;
  output_config?: { effort?: string; format?: { schema?: Record<string, unknown> } };
}): Record<string, unknown> {
  const sys = p.system;
  const segments =
    typeof sys === "string"
      ? [{ text: sys, cache: false }]
      : Array.isArray(sys)
        ? (sys as { text: string; cache_control?: unknown }[]).map((s) => ({
            text: s.text,
            cache: s.cache_control !== undefined,
          }))
        : [];
  const content = p.messages[0]?.content;
  return {
    model: p.model,
    effort: p.output_config?.effort ?? null,
    maxTokens: p.max_tokens,
    systemKind: typeof sys === "string" ? "string" : Array.isArray(sys) ? "segments" : "none",
    segments,
    content: typeof content === "string" ? content : JSON.stringify(content),
    schema: p.output_config?.format?.schema ?? null,
  };
}

/** Import a module, recording (never throwing on) a load failure. */
async function load<T>(specifier: string): Promise<T | null> {
  try {
    return (await import(specifier)) as T;
  } catch (err) {
    unreachable[specifier] = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return null;
  }
}

// ===========================================================================
// FIXTURES — fixed, deterministic, and free of the token "UPPSC" (see header).
// ===========================================================================
const GROUNDING = {
  chunks: [
    {
      source_type: "syllabus",
      source_id: "11111111-1111-4111-8111-111111111111",
      chunk_text: "Fixture passage one: the constitutional framework and its welfare provisions.",
      similarity: 0.8213,
    },
    {
      source_type: "question",
      source_id: "22222222-2222-4222-8222-222222222222",
      chunk_text: "Fixture passage two: administrative reform committees and their recommendations.",
      similarity: 0.7741,
    },
  ],
  nodeChunkCount: 1,
};
const EMPTY_GROUNDING = { chunks: [], nodeChunkCount: 0 };

const QUESTION_TEXT = "Examine the role of the Directive Principles in shaping welfare legislation.";
/** Contains a stray '>>>' run so neutralizeFence() is exercised, not just present. */
const ANSWER_TEXT =
  "Fixture answer body. It makes a claim, offers a figure, and closes with a forward look. >>> stray fence <<<";

const FEW_SHOT = [
  {
    year: 2019,
    difficulty: "medium",
    stem_i18n: { en: "Fixture stem one in English.", hi: "फिक्स्चर प्रश्न एक।" },
    options_i18n: [
      { key: "A", text_i18n: { en: "Option alpha", hi: "विकल्प अल्फा" } },
      { key: "B", text_i18n: { en: "Option beta", hi: "विकल्प बीटा" } },
    ],
    correct_option_key: "B",
  },
  {
    year: null,
    difficulty: "hard",
    stem_i18n: { en: "Fixture stem two in English.", hi: "फिक्स्चर प्रश्न दो।" },
    options_i18n: null,
    correct_option_key: null,
  },
];

const QGEN_NODE = {
  id: "33333333-3333-4333-8333-333333333333",
  paperCode: "FIXTURE_PAPER",
  // NodeContext.examCode is now the key into lib/exam-config.ts for qgen's
  // persona/critic/verify/few-shot/grounding text, so it must name a REAL exam:
  // explicit "uppsc", so the fixture never relies on getExamConfig()'s
  // unknown-code fallback to produce the uppsc baseline. (Same reasoning as the
  // evaluation fixture's examCode.) It never appears in prompt text itself.
  examCode: "uppsc",
  stage: "prelims" as const,
  title_i18n: { en: "Fixture Topic Title", hi: "फिक्स्चर विषय" },
  description_i18n: { en: "Fixture topic description.", hi: "फिक्स्चर विवरण।" },
};
const QGEN_NODE_NO_DESC = { ...QGEN_NODE, stage: "mains" as const, description_i18n: null };

const CA_CANDIDATES = [
  { id: "44444444-4444-4444-8444-444444444444", title: "Fixture Node One", paperCode: "FIXTURE_PAPER", examCode: "fixture-exam" },
  { id: "55555555-5555-4555-8555-555555555555", title: "Fixture Node Two", paperCode: "FIXTURE_PAPER", examCode: "fixture-exam" },
];

const NOTES_NODE = {
  id: "66666666-6666-4666-8666-666666666666",
  paperCode: "FIXTURE_PAPER",
  stage: "mains" as const,
  title_i18n: { en: "Fixture Note Topic", hi: "फिक्स्चर टिप्पणी विषय" },
  description_i18n: { en: "Fixture note description.", hi: "फिक्स्चर टिप्पणी विवरण।" },
};

const CHAPTER_NODE = {
  id: "77777777-7777-4777-8777-777777777777",
  paperCode: "FIXTURE_PAPER",
  stage: "prelims" as const,
  title_en: "Fixture Chapter Topic",
  description_en: "Fixture chapter description.",
  childTitles: ["Fixture Child One", "Fixture Child Two"],
};
const CHAPTER_NODE_BARE = { ...CHAPTER_NODE, stage: "mains" as const, description_en: null, childTitles: [] };

const WEIGHTAGE = { totalPyqs: 12, byYear: { "2021": 3, "2022": 4, "2023": 5 }, lastAskedYear: 2023 };
const WEIGHTAGE_EMPTY = { totalPyqs: 0, byYear: {}, lastAskedYear: null };

/** A CurrentAffairsMainsBrief — feeds ca/mainsQuestionParams and ca/deepdive's buildContext. */
const CA_MAINS_BRIEF = {
  why_in_news_i18n: { en: "Fixture why in news.", hi: "क्यों समाचार में।" },
  background_i18n: { en: "Fixture background.", hi: "पृष्ठभूमि।" },
  significance_i18n: { en: ["Sig one", "Sig two"], hi: ["महत्व एक", "महत्व दो"] },
  challenges_i18n: { en: ["Chal one"], hi: ["चुनौती एक"] },
  way_forward_i18n: { en: ["Way one", "Way two"], hi: ["मार्ग एक", "मार्ग दो"] },
  keywords_i18n: { en: ["kw one", "kw two"], hi: ["कुं एक"] },
  case_examples_i18n: { en: [], hi: [] },
};

/** A ca/deepdive RankedIssue — relatedItems non-empty so that branch renders too. */
const DEEP_DIVE_ISSUE = {
  item: {
    title_i18n: { en: "Fixture deep-dive issue", hi: "फिक्स्चर गहन विश्लेषण" },
    mains_brief: CA_MAINS_BRIEF,
    syllabus_node_ids: [],
  },
  relatedItems: [
    { title_i18n: { en: "Related one" }, mains_brief: { why_in_news_i18n: { en: "Because reasons." } } },
  ],
};

const WEB_SOURCES = [
  { id: "S1", title: "Fixture Source One", url: "https://example.invalid/one" },
  { id: "S2", title: "Fixture Source Two", url: "https://example.invalid/two" },
];
const RESEARCH_TEXT = "Fixture research synthesis mentioning a figure [S1] and a scheme [S2].";

// ===========================================================================
// COLLECTORS
// ===========================================================================
async function collectEvaluationPrompts(): Promise<void> {
  const rubricMod = await load<typeof import("../src/services/evaluation/rubric.js")>(
    "../src/services/evaluation/rubric.js",
  );
  if (rubricMod) {
    put("rubric/renderRubricForPrompt:v1", rubricMod.renderRubricForPrompt("v1"));
    put("rubric/renderRubricForPrompt:essay-v1", rubricMod.renderRubricForPrompt("essay-v1"));
    // No-arg default and an unknown version (which getRubric() falls back to v1
    // for) are separate branches of the same function — both are live paths.
    put("rubric/renderRubricForPrompt:default-noarg", rubricMod.renderRubricForPrompt());
    put("rubric/renderRubricForPrompt:unknown-version-fallback", rubricMod.renderRubricForPrompt("does-not-exist"));
    put(
      "rubric/RUBRICS:labels-and-weights",
      Object.fromEntries(
        Object.entries(rubricMod.RUBRICS).map(([version, def]) => [
          version,
          {
            examCode: def.examCode,
            kind: def.kind,
            // Snapshotted alongside `kind` so the two axes stay visibly
            // distinct: `kind` is the persisted board axis, `modelAnswerShape`
            // routes pass 2 (M35). A mis-assignment here is a wrong model
            // answer, so it is worth pinning.
            modelAnswerShape: def.modelAnswerShape,
            paperCodes: [...def.paperCodes],
            defaults: def.defaults,
            dimensions: def.dimensions.map((d) => ({ key: d.key, label: d.label, weight: d.weight, description: d.description })),
          },
        ]),
      ),
    );
  }

  const mod = await load<typeof import("../src/services/evaluation/prompts.js")>(
    "../src/services/evaluation/prompts.js",
  );
  if (!mod) return;

  // --- pass 1: system, all four rubric x image branches + the no-arg default
  put("evaluation/buildAnalysisSystem:gs-noimage", mod.buildAnalysisSystem("uppsc", false, "v1"));
  put("evaluation/buildAnalysisSystem:gs-image", mod.buildAnalysisSystem("uppsc", true, "v1"));
  put("evaluation/buildAnalysisSystem:essay-noimage", mod.buildAnalysisSystem("uppsc", false, "essay-v1"));
  put("evaluation/buildAnalysisSystem:essay-image", mod.buildAnalysisSystem("uppsc", true, "essay-v1"));
  put("evaluation/buildAnalysisSystem:default-noargs", mod.buildAnalysisSystem("uppsc"));

  // --- pass 1: user content
  const ctx = (over: Record<string, unknown> = {}) =>
    ({
      questionText: QUESTION_TEXT,
      answerText: ANSWER_TEXT,
      mode: "typed",
      language: "en",
      wordLimit: 150,
      maxScore: 10,
      wordCount: 142,
      grounding: GROUNDING,
      rubricVersion: "v1",
      // Explicit, so the fixture never relies on getExamConfig()'s
      // unknown-code fallback to produce the uppsc baseline.
      examCode: "uppsc",
      ...over,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  put("evaluation/buildAnalysisUserContent:typed-en-grounded", mod.buildAnalysisUserContent(ctx()));
  put(
    "evaluation/buildAnalysisUserContent:handwritten-hi-ungrounded",
    mod.buildAnalysisUserContent(ctx({ mode: "handwritten", language: "hi", grounding: EMPTY_GROUNDING })),
  );
  // The image variant returns a content-part array; only the TEXT part is
  // prompt text (the other part is base64 image bytes), so snapshot just that.
  const withImage = mod.buildAnalysisUserContent(ctx(), {
    base64: "ZmFrZQ==",
    mediaType: "image/jpeg",
  });
  const textPart = Array.isArray(withImage)
    ? withImage.find((p): p is { type: "text"; text: string } => p.type === "text")?.text
    : withImage;
  put("evaluation/buildAnalysisUserContent:with-image-textpart", textPart ?? null);
  put(
    "evaluation/buildAnalysisUserContent:with-image-partkinds",
    Array.isArray(withImage) ? withImage.map((p) => p.type) : "string",
  );

  put("evaluation/analysisJsonSchema", mod.analysisJsonSchema());

  // --- pass 2: feedback
  put("evaluation/buildStrengthsSystem:en", mod.buildStrengthsSystem("uppsc", "en"));
  put("evaluation/buildStrengthsSystem:hi", mod.buildStrengthsSystem("uppsc", "hi"));
  // The improvements prompt names the rubric's own top-weighted dimensions
  // (M30), so it varies per rubric VERSION as well as per exam. "v1"/"essay-v1"
  // are fixed fixtures on purpose: they are persisted identifiers that must never
  // be renamed (see rubric.ts's header).
  //
  // ⚑ THE `upsc` KEYS BELOW ARE THE HARNESS'S FIRST NON-`uppsc` FIXTURES, and are
  // deliberate. Every other key in this file is built with the "uppsc" exam
  // fixture, so "N prompts byte-identical" is predominantly a UPPSC regression
  // check — it says very little about UPSC's prompts. The improvements prompt is
  // the one place that changes with the RUBRIC rather than only with the exam, and
  // `upsc-ethics-v1` is where the five rubrics' lever sets diverge most (it is the
  // only one whose `examples_data` is its LOWEST weight), so leaving it unguarded
  // would mean the M30 derivation was only ever pinned in its two UPPSC shapes.
  // Adding more `upsc` coverage elsewhere is welcome; it just has not been done.
  put("evaluation/buildImprovementsSystem:en", mod.buildImprovementsSystem("uppsc", "en", "v1"));
  put("evaluation/buildImprovementsSystem:hi", mod.buildImprovementsSystem("uppsc", "hi", "v1"));
  put(
    "evaluation/buildImprovementsSystem:essay-v1:en",
    mod.buildImprovementsSystem("uppsc", "en", "essay-v1"),
  );
  put(
    "evaluation/buildImprovementsSystem:essay-v1:hi",
    mod.buildImprovementsSystem("uppsc", "hi", "essay-v1"),
  );
  put(
    "evaluation/buildImprovementsSystem:upsc-gs-v1:en",
    mod.buildImprovementsSystem("upsc", "en", "upsc-gs-v1"),
  );
  put(
    "evaluation/buildImprovementsSystem:upsc-ethics-v1:en",
    mod.buildImprovementsSystem("upsc", "en", "upsc-ethics-v1"),
  );
  put("evaluation/FEEDBACK_WRITE_NOW", mod.FEEDBACK_WRITE_NOW);

  const keys = rubricMod ? rubricMod.RUBRIC_DIMENSION_KEYS : [];
  const dims: Record<string, { score: number; justification: string }> = {};
  keys.forEach((k, i) => {
    dims[k] = { score: 3 + i, justification: `Fixture justification for ${k}.` };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pass1 = (over: Record<string, unknown> = {}): any => ({
    is_off_topic: false,
    reference_points: ["Fixture reference point one.", "Fixture reference point two."],
    dimensions: dims,
    missed_key_points: ["Fixture missed point one."],
    factual_errors: [{ quote: "a quoted claim", issue: "the figure is wrong" }],
    overall_comment: "Fixture overall examiner comment.",
    ...over,
  });

  put("evaluation/buildFeedbackSharedContext:full", mod.buildFeedbackSharedContext(ctx(), pass1()));
  put(
    "evaluation/buildFeedbackSharedContext:empty-lists-offtopic",
    mod.buildFeedbackSharedContext(
      ctx(),
      pass1({ is_off_topic: true, missed_key_points: [], factual_errors: [] }),
    ),
  );

  // --- pass 2: model answer (gs/essay x en/hi)
  put("evaluation/buildModelAnswerSystem:gs-en", mod.buildModelAnswerSystem(ctx()));
  put("evaluation/buildModelAnswerSystem:gs-hi", mod.buildModelAnswerSystem(ctx({ language: "hi" })));
  put(
    "evaluation/buildModelAnswerSystem:essay-en",
    mod.buildModelAnswerSystem(ctx({ rubricVersion: "essay-v1", wordLimit: 700, maxScore: 50 })),
  );
  put(
    "evaluation/buildModelAnswerSystem:essay-hi",
    mod.buildModelAnswerSystem(ctx({ rubricVersion: "essay-v1", wordLimit: 700, maxScore: 50, language: "hi" })),
  );
  // The third `modelAnswerShape` (M35). Guarded because it is the branch whose
  // whole purpose is NOT to say what the two above say — a regression here would
  // silently re-introduce the pass-1/pass-2 contradiction it was added to fix.
  // 250 words / 20 marks are `upsc-ethics-v1`'s own defaults.
  put(
    "evaluation/buildModelAnswerSystem:upsc-ethics-en",
    mod.buildModelAnswerSystem(
      ctx({ examCode: "upsc", rubricVersion: "upsc-ethics-v1", wordLimit: 250, maxScore: 20 }),
    ),
  );
  put("evaluation/buildModelAnswerUserContent:with-points", mod.buildModelAnswerUserContent(ctx(), pass1()));
  put(
    "evaluation/buildModelAnswerUserContent:no-points",
    mod.buildModelAnswerUserContent(ctx({ language: "hi" }), pass1({ reference_points: [], missed_key_points: [] })),
  );
}

async function collectMentorPrompts(): Promise<void> {
  const mod = await load<typeof import("../src/services/mentor/prompts.js")>("../src/services/mentor/prompts.js");
  if (!mod) return;

  put("mentor/buildMentorPersona:en", mod.buildMentorPersona("uppsc", "en"));
  put("mentor/buildMentorPersona:hi", mod.buildMentorPersona("uppsc", "hi"));
  put("mentor/buildTeacherPersona:en", mod.buildTeacherPersona("uppsc", "en"));
  put("mentor/buildTeacherPersona:hi", mod.buildTeacherPersona("uppsc", "hi"));
  put("mentor/buildRevisionCompressionSystem:en", mod.buildRevisionCompressionSystem("uppsc", "en"));
  put("mentor/buildRevisionCompressionSystem:hi", mod.buildRevisionCompressionSystem("uppsc", "hi"));
  put("mentor/buildProfileSegment:filled", mod.buildProfileSegment("Weak in polity. 12-day streak. 40 cards due."));
  put("mentor/buildProfileSegment:empty", mod.buildProfileSegment("   "));

  // The per-message turns carry the localised heading anchors and the depth
  // directives — both are exam-facing copy the refactor could touch.
  put(
    "mentor/buildUserTurn:normal-with-context",
    mod.buildUserTurn({ context: "1. Fixture context snippet.", question: "What is <this> about?", weak: true, mode: "normal" }),
  );
  put(
    "mentor/buildUserTurn:revision-no-context",
    mod.buildUserTurn({ context: "", question: "Fixture doubt.", weak: false, mode: "revision" }),
  );
  for (const locale of ["en", "hi"] as const) {
    for (const depth of ["quick", "standard", "in_depth"] as const) {
      put(
        `mentor/buildTeacherTurn:${locale}-${depth}`,
        mod.buildTeacherTurn({
          context: "1. Fixture context snippet.",
          web: "Fixture web synthesis [S1].",
          question: "Teach me <this> topic.",
          weak: true,
          depth,
          locale,
        }),
      );
    }
  }
  put(
    "mentor/buildTeacherTurn:en-standard-no-context-no-web",
    mod.buildTeacherTurn({ context: "", web: "", question: "Fixture topic.", weak: false, depth: "standard", locale: "en" }),
  );
}

async function collectQgenPrompts(): Promise<void> {
  const mod = await load<typeof import("../src/qgen/prompts.js")>("../src/qgen/prompts.js");
  if (!mod) return;

  put("qgen/QGEN_PROMPT_VERSION", mod.QGEN_PROMPT_VERSION);
  put("qgen/fewShotBlock:with-examples", mod.fewShotBlock(FEW_SHOT as never, "uppsc"));
  put("qgen/fewShotBlock:empty", mod.fewShotBlock([], "uppsc"));

  const genOpts = (over: Record<string, unknown> = {}) =>
    ({
      node: QGEN_NODE,
      examples: FEW_SHOT,
      grounding: GROUNDING,
      count: 3,
      difficultyHint: "Aim for a medium difficulty mix.",
      variantHint: "Vary the sub-aspect tested.",
      ...over,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

  put("qgen/buildMcqGenParams:grounded-fewshot", paramsSnapshot(mod.buildMcqGenParams(genOpts())));
  put(
    "qgen/buildMcqGenParams:ungrounded-noexamples-nodesc",
    paramsSnapshot(mod.buildMcqGenParams(genOpts({ node: QGEN_NODE_NO_DESC, examples: [], grounding: EMPTY_GROUNDING }))),
  );
  put("qgen/buildDescGenParams:grounded-fewshot", paramsSnapshot(mod.buildDescGenParams(genOpts())));
  put(
    "qgen/buildDescGenParams:ungrounded-noexamples-nodesc",
    paramsSnapshot(mod.buildDescGenParams(genOpts({ node: QGEN_NODE_NO_DESC, examples: [], grounding: EMPTY_GROUNDING }))),
  );

  const mcq = {
    stem_i18n: { en: "Fixture generated stem.", hi: "फिक्स्चर उत्पन्न प्रश्न।" },
    options: [
      { key: "A", text_i18n: { en: "Alpha", hi: "अल्फा" } },
      { key: "B", text_i18n: { en: "Beta", hi: "बीटा" } },
      { key: "C", text_i18n: { en: "Gamma", hi: "गामा" } },
      { key: "D", text_i18n: { en: "Delta", hi: "डेल्टा" } },
    ],
    correct_option_key: "C",
    explanation_i18n: { en: "Fixture explanation.", hi: "फिक्स्चर व्याख्या।" },
    difficulty: "medium" as const,
  };
  const desc = {
    stem_i18n: { en: "Fixture descriptive stem.", hi: "फिक्स्चर वर्णनात्मक प्रश्न।" },
    marks: 10,
    word_limit: 200,
    marking_points_i18n: { en: ["Point one", "Point two"], hi: ["बिंदु एक", "बिंदु दो"] },
    difficulty: "hard" as const,
  };
  put("qgen/renderQuestionForCritic:mcq", mod.renderQuestionForCritic.mcq(mcq as never));
  put("qgen/renderQuestionForCritic:descriptive", mod.renderQuestionForCritic.descriptive(desc as never));

  put(
    "qgen/buildCriticParams:mcq-grounded",
    paramsSnapshot(
      mod.buildCriticParams({
        node: QGEN_NODE as never,
        rendered: mod.renderQuestionForCritic.mcq(mcq as never),
        grounding: GROUNDING as never,
      }),
    ),
  );
  put(
    "qgen/buildCriticParams:descriptive-ungrounded",
    paramsSnapshot(
      mod.buildCriticParams({
        node: QGEN_NODE_NO_DESC as never,
        rendered: mod.renderQuestionForCritic.descriptive(desc as never),
        grounding: EMPTY_GROUNDING as never,
      }),
    ),
  );
  put(
    "qgen/buildVerifyParams:grounded",
    paramsSnapshot(
      mod.buildVerifyParams({
        stemEn: mcq.stem_i18n.en,
        options: mcq.options,
        grounding: GROUNDING as never,
        examCode: "uppsc",
      }),
    ),
  );
  put(
    "qgen/buildVerifyParams:ungrounded",
    paramsSnapshot(
      mod.buildVerifyParams({
        stemEn: mcq.stem_i18n.en,
        options: mcq.options,
        grounding: EMPTY_GROUNDING as never,
        examCode: "uppsc",
      }),
    ),
  );
}

async function collectCaPrompts(): Promise<void> {
  const mod = await load<typeof import("../src/ca/prompts.js")>("../src/ca/prompts.js");
  if (mod) {
    put(
      "ca/triageParams:up-source",
      paramsSnapshot(
        mod.triageParams({
          title: "Fixture headline about a scheme launch.",
          snippet: "Fixture snippet describing the launch and its coverage.",
          sourceIsUp: true,
          candidates: CA_CANDIDATES as never,
          examCode: "uppsc",
        }),
      ),
    );
    put(
      "ca/triageParams:national-source-no-candidates",
      paramsSnapshot(
        mod.triageParams({
          title: "Fixture national headline.",
          snippet: "Fixture national snippet.",
          sourceIsUp: false,
          candidates: [],
          examCode: "uppsc",
        }),
      ),
    );

    const enrich = (over: Record<string, unknown> = {}) =>
      ({
        title: "Fixture headline about a scheme launch.",
        snippet: "Fixture snippet describing the launch and its coverage.",
        category: "schemes",
        hasPrelimsLife: true,
        hasMainsLife: true,
        linkedNodes: CA_CANDIDATES,
        examCode: "uppsc",
        ...over,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    put("ca/enrichParams:both-lives", paramsSnapshot(mod.enrichParams(enrich())));
    put("ca/enrichParams:prelims-only", paramsSnapshot(mod.enrichParams(enrich({ hasMainsLife: false }))));
    put("ca/enrichParams:mains-only", paramsSnapshot(mod.enrichParams(enrich({ hasPrelimsLife: false }))));
    put(
      "ca/enrichParams:no-lives-no-nodes",
      paramsSnapshot(mod.enrichParams(enrich({ hasPrelimsLife: false, hasMainsLife: false, linkedNodes: [] }))),
    );
  }

  const classify = await load<typeof import("../src/ca/mcq-node-classify.js")>("../src/ca/mcq-node-classify.js");
  if (classify) {
    put("ca/MCQ_NODE_CLASSIFY_SYSTEM", classify.MCQ_NODE_CLASSIFY_SYSTEM("uppsc"));
    put(
      "ca/buildMcqNodeClassifySchema",
      classify.buildMcqNodeClassifySchema(CA_CANDIDATES.map((c) => c.id)),
    );
  }
}

async function collectNotesPrompts(): Promise<void> {
  const mod = await load<typeof import("../src/notes/prompts.js")>("../src/notes/prompts.js");
  if (mod) {
    put("notes/NOTES_PROMPT_VERSION", mod.NOTES_PROMPT_VERSION);
    put("notes/RESEARCH_SYSTEM_PROMPT", mod.RESEARCH_SYSTEM_PROMPT("uppsc"));
    put("notes/buildResearchContent:with-desc", mod.buildResearchContent(NOTES_NODE as never, "uppsc"));
    put(
      "notes/buildResearchContent:no-desc-prelims",
      mod.buildResearchContent({ ...NOTES_NODE, stage: "prelims", description_i18n: null } as never, "uppsc"),
    );
    put("notes/NOTE_GEN_SCHEMA", mod.NOTE_GEN_SCHEMA);
    put("notes/NOTE_CRITIC_SCHEMA", mod.NOTE_CRITIC_SCHEMA);

    const noteGen = (over: Record<string, unknown> = {}) =>
      ({
        node: NOTES_NODE,
        pyqs: [
          { year: 2022, stem_en: "Fixture past question one.", explanation_en: "Fixture explanation one." },
          { year: null, stem_en: "Fixture past question two.", explanation_en: null },
        ],
        weightage: WEIGHTAGE,
        ca: [{ title_en: "Fixture CA item", summary_en: "Fixture CA summary.", url: "https://example.invalid/ca" }],
        grounding: GROUNDING,
        research: RESEARCH_TEXT,
        sources: WEB_SOURCES,
        examCode: "uppsc",
        ...over,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    put("notes/buildNoteGenParams:full", paramsSnapshot(mod.buildNoteGenParams(noteGen())));
    put(
      "notes/buildNoteGenParams:bare",
      paramsSnapshot(
        mod.buildNoteGenParams(
          noteGen({
            node: { ...NOTES_NODE, stage: "prelims", description_i18n: null },
            pyqs: [],
            weightage: WEIGHTAGE_EMPTY,
            ca: [],
            grounding: EMPTY_GROUNDING,
            research: "",
            sources: [],
          }),
        ),
      ),
    );

    const noteBody = {
      overview: "Fixture overview paragraph.",
      key_facts: [
        { fact: "Fixture fact one.", source_ref: "S1" },
        { fact: "Fixture fact two.", source_ref: null },
      ],
      up_angle: "Fixture state angle.",
      pyq_analysis: "Fixture past-question analysis.",
      mnemonics: ["Fixture mnemonic."],
      quick_revision: ["Fixture revision bullet."],
      further_reading: [{ title: "Fixture link", url: "https://example.invalid/read" }],
    };
    put(
      "notes/buildNoteCriticParams",
      paramsSnapshot(
        mod.buildNoteCriticParams({
          node: NOTES_NODE as never,
          content: { en: noteBody, hi: noteBody } as never,
          examCode: "uppsc",
        }),
      ),
    );
  }

  const chapter = await load<typeof import("../src/notes/chapter-prompts.js")>("../src/notes/chapter-prompts.js");
  if (!chapter) return;

  put("notes/CHAPTER_PROMPT_VERSION", chapter.CHAPTER_PROMPT_VERSION);
  put("notes/CHAPTER_RESEARCH_SYSTEM", chapter.CHAPTER_RESEARCH_SYSTEM("uppsc"));
  put("notes/FACT_ESCALATE_SYSTEM", chapter.FACT_ESCALATE_SYSTEM("uppsc"));
  put("notes/OUTLINE_SCHEMA", chapter.OUTLINE_SCHEMA);
  put("notes/SECTION_SCHEMA", chapter.SECTION_SCHEMA);
  put("notes/COHERENCE_SCHEMA", chapter.COHERENCE_SCHEMA);
  put("notes/AUDIT_SCHEMA", chapter.AUDIT_SCHEMA);

  put("notes/buildChapterResearchContent:full", chapter.buildChapterResearchContent(CHAPTER_NODE as never, "uppsc"));
  put("notes/buildChapterResearchContent:bare", chapter.buildChapterResearchContent(CHAPTER_NODE_BARE as never, "uppsc"));

  const PYQS = [
    { n: 1, id: "88888888-8888-4888-8888-888888888881", year: 2021, stem_en: "Fixture chapter PYQ one.", explanation_en: "Fixture reason." },
    { n: 2, id: "88888888-8888-4888-8888-888888888882", year: null, stem_en: "Fixture chapter PYQ two.", explanation_en: null },
  ];

  put(
    "notes/buildOutlineParams:full",
    paramsSnapshot(chapter.buildOutlineParams({ node: CHAPTER_NODE as never, weightage: WEIGHTAGE, pyqs: PYQS, examCode: "uppsc" })),
  );
  put(
    "notes/buildOutlineParams:bare",
    paramsSnapshot(
      chapter.buildOutlineParams({ node: CHAPTER_NODE_BARE as never, weightage: WEIGHTAGE_EMPTY, pyqs: [], examCode: "uppsc" }),
    ),
  );

  const ctxBlockFull = chapter.chapterContextBlock({
    node: CHAPTER_NODE as never,
    weightage: WEIGHTAGE,
    grounding: GROUNDING as never,
    research: RESEARCH_TEXT,
    sources: WEB_SOURCES,
    pyqs: PYQS,
    examCode: "uppsc",
  });
  const ctxBlockBare = chapter.chapterContextBlock({
    node: CHAPTER_NODE_BARE as never,
    weightage: WEIGHTAGE_EMPTY,
    grounding: EMPTY_GROUNDING as never,
    research: "",
    sources: [],
    pyqs: [],
    examCode: "uppsc",
  });
  put("notes/chapterContextBlock:full", ctxBlockFull);
  put("notes/chapterContextBlock:bare", ctxBlockBare);

  const section = {
    id: "fixture-section",
    heading_en: "Fixture Section Heading",
    focus: "Fixture focus line.",
    planned_boxes: ["prelims_facts", "mains_angle"] as never,
    needs_diagram: true,
    diagram_hint: "a process flow",
  };
  put(
    "notes/buildSectionParams:with-diagram",
    paramsSnapshot(
      chapter.buildSectionParams({
        context: ctxBlockFull,
        section,
        allHeadings: ["Fixture Section Heading", "Other Section A", "Other Section B"],
        examCode: "uppsc",
      }),
    ),
  );
  put(
    "notes/buildSectionParams:no-diagram-no-boxes",
    paramsSnapshot(
      chapter.buildSectionParams({
        context: ctxBlockBare,
        section: { ...section, planned_boxes: [] as never, needs_diagram: false, diagram_hint: "" },
        allHeadings: ["Fixture Section Heading"],
        examCode: "uppsc",
      }),
    ),
  );

  put(
    "notes/buildCoherenceParams",
    paramsSnapshot(
      chapter.buildCoherenceParams([
        { id: "s1", heading_en: "Section One", body_md: "Fixture body one." },
        { id: "s2", heading_en: "Section Two", body_md: "Fixture body two." },
      ]),
    ),
  );
  put(
    "notes/buildAuditParams",
    paramsSnapshot(
      chapter.buildAuditParams({
        facts: [
          { index: 0, claim: "Fixture decisive claim one." },
          { index: 1, claim: "Fixture decisive claim two." },
        ],
        context: ctxBlockFull,
        examCode: "uppsc",
      }),
    ),
  );
}

async function collectQuestionExplanationPrompts(): Promise<void> {
  const mod = await load<typeof import("../src/services/question-explanation.js")>(
    "../src/services/question-explanation.js",
  );
  if (!mod) return;
  // groundingBlockText is the ONLY prompt fragment this module exports; its
  // EXPLAIN_SYSTEM / EXPLAIN_SCHEMA and the user-content template are private
  // (see __not_reachable_without_editing__).
  put("question-explanation/groundingBlockText:grounded", mod.groundingBlockText(GROUNDING as never));
  put("question-explanation/groundingBlockText:empty", mod.groundingBlockText(EMPTY_GROUNDING as never));
  // Newly reachable (multi-exam slice 2d): both were module-private consts /
  // inline route literals before the conversion exported them.
  put("question-explanation/explainSystem", mod.explainSystem("uppsc"));
  put("question-explanation/streamExplainSystem", mod.streamExplainSystem("uppsc"));
}

// ===========================================================================
// Newly reachable in multi-exam slice 2d — each of these was a module-private
// const, a module-private function, or an anonymous inline literal inside the
// very model call that issued it, and is listed as such in the baseline's
// __not_reachable_without_editing__ block until this commit exported it.
// ===========================================================================
async function collectSlice2dPrompts(): Promise<void> {
  const anthropic = await load<typeof import("../src/lib/anthropic.js")>("../src/lib/anthropic.js");
  if (anthropic) {
    // translate()'s system prompt. The domainHint argument is a REQUIRED
    // parameter now (its "UPPSC exam-prep content" default was removed), so both
    // the configured generic hint and a caller-specific one are snapshotted.
    put(
      "anthropic/buildTranslateSystem:generic-hint",
      anthropic.buildTranslateSystem("uppsc", "UPPSC exam-prep content"),
    );
    put(
      "anthropic/buildTranslateSystem:explanation-hint",
      anthropic.buildTranslateSystem("uppsc", "UPPSC MCQ explanation"),
    );
  }

  const drills = await load<typeof import("../src/services/micro-drills.js")>("../src/services/micro-drills.js");
  if (drills) {
    put("micro-drills/buildDrillEvaluationSystem:intro", drills.buildDrillEvaluationSystem("uppsc", "intro"));
    put("micro-drills/buildDrillEvaluationSystem:conclusion", drills.buildDrillEvaluationSystem("uppsc", "conclusion"));
  }

  const plan = await load<typeof import("../src/services/study-plan.js")>("../src/services/study-plan.js");
  if (plan) {
    put("study-plan/buildPlanSystem", plan.buildPlanSystem("uppsc"));
    const planInput = (over: Record<string, unknown> = {}) =>
      ({
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        examCode: "uppsc",
        hoursPerDay: 4,
        today: "2026-01-02",
        targetDate: "2026-12-06",
        displayName: "Fixture Learner",
        targetExamYear: 2026,
        medium: "en",
        nextExam: {
          title_i18n: { en: "Fixture Prelims", hi: "फिक्स्चर प्रारंभिक" },
          exam_date: "2026-12-06",
          days_until: 338,
        },
        weakSections: [
          { title_i18n: { en: "Fixture Weak Section", hi: "फिक्स्चर अनुभाग" }, pyq_count: 41, mastery_level: "bronze" },
        ],
        srsDueCount: 17,
        ...over,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any;
    put("study-plan/buildPlanContent:full", plan.buildPlanContent(planInput()));
    // The no-display-name branch is the one that renders the configured
    // aspirant fallback — the only exam-bearing string in this builder.
    put(
      "study-plan/buildPlanContent:no-name-no-exam-no-weak",
      plan.buildPlanContent(planInput({ displayName: null, targetExamYear: null, nextExam: null, weakSections: [] })),
    );
  }

  const userNotes = await load<typeof import("../src/services/user-notes.js")>("../src/services/user-notes.js");
  if (userNotes) {
    put("user-notes/buildUserNoteConvertSystem:en", userNotes.buildUserNoteConvertSystem("uppsc", "en"));
    put("user-notes/buildUserNoteConvertSystem:hi", userNotes.buildUserNoteConvertSystem("uppsc", "hi"));
  }

  const ocr = await load<typeof import("../src/services/ocr/claude-vision-provider.js")>(
    "../src/services/ocr/claude-vision-provider.js",
  );
  if (ocr) {
    put("ocr/buildTranscribeSystem:en", ocr.buildTranscribeSystem("uppsc", "en"));
    put("ocr/buildTranscribeSystem:hi", ocr.buildTranscribeSystem("uppsc", "hi"));
  }

  const moderation = await load<typeof import("../src/lib/community-moderation.js")>(
    "../src/lib/community-moderation.js",
  );
  if (moderation) put("community-moderation/buildScreenSystem", moderation.buildScreenSystem("uppsc"));

  // ingest/series.ts is import-safe (no top-level main()); its sibling ingest
  // CLIs (explain/syllabus/pyq) are NOT — their exam-bearing system prompts now
  // live in the side-effect-free ingest/prompts.ts and are covered below.
  const series = await load<typeof import("../src/ingest/series.js")>("../src/ingest/series.js");
  if (series) put("ingest/seriesSystem", series.seriesSystem("uppsc"));
}

// ===========================================================================
// Newly reachable in the post-refactor audit pass.
//
// Each of these was CONVERTED to a config read by the exam-config sweep but was
// covered by NO machine check — it sat in the baseline's
// __not_reachable_without_editing__ block, verified only by eyeball. Extracting
// a pure builder (the same move slice 2d made for the others) is what makes a
// byte diff possible at all.
//
// Every value below was ALSO proved byte-identical to the PRE-REFACTOR text —
// reconstructed mechanically from `git show 14a1493:<path>` rather than from
// today's output, so this baseline records the original strings, not merely
// whatever the refactor happened to produce. 15/15 exact, 0 differences.
// ===========================================================================
async function collectPostRefactorAuditPrompts(): Promise<void> {
  // --- ca/prompts.ts: the two prompts that were inline object-literal
  //     properties of the very structuredJson({...}) call that issued them.
  const ca = await load<typeof import("../src/ca/prompts.js")>("../src/ca/prompts.js");
  if (ca) {
    put(
      "ca/mcqsParams:with-examples",
      paramsSnapshot(
        ca.mcqsParams({
          title: "Fixture current-affairs headline",
          facts: ["Fixture fact one.", "Fixture fact two."],
          examples: FEW_SHOT as never,
          examCode: "uppsc",
        }),
      ),
    );
    // No examples => fewShotBlock([]) degrades to the generic style instruction;
    // that is the mentor teach-mode quick-check's live path.
    put(
      "ca/mcqsParams:no-examples",
      paramsSnapshot(
        ca.mcqsParams({ title: "Fixture headline", facts: ["Only fact."], examCode: "uppsc" }),
      ),
    );
    put(
      "ca/mainsQuestionParams",
      paramsSnapshot(
        ca.mainsQuestionParams({ title: "Fixture mains issue title", brief: CA_MAINS_BRIEF as never, examCode: "uppsc" }),
      ),
    );
  }

  // --- ca/deepdive.ts: all three were module-private, with no pure params
  //     builder, behind a runDeepDives() that deletes rows and runs a batch.
  const deep = await load<typeof import("../src/ca/deepdive.js")>("../src/ca/deepdive.js");
  if (deep) {
    put("ca/DEEP_DIVE_SYSTEM", deep.DEEP_DIVE_SYSTEM("uppsc"));
    put("ca/DEEP_DIVE_SCHEMA", deep.DEEP_DIVE_SCHEMA);
    // BOTH branches: the pyqText one is the only place the converted
    // ca.deepDivePyqHeader renders, and that config value now carries the
    // header's LEADING "\n" inside itself (it used to be a bare array element
    // joined with "\n"), so a lost newline would show up only here.
    put(
      "ca/deepdive:buildContext:with-notes-and-pyqs",
      deep.buildContext(DEEP_DIVE_ISSUE as never, "Fixture notes text.", "- Fixture past question?", "uppsc"),
    );
    put("ca/deepdive:buildContext:bare", deep.buildContext(DEEP_DIVE_ISSUE as never, "", "", "uppsc"));
  }

  // --- services/user-notes.ts: the translate domain hint, previously observable
  //     only by actually running a translation (the function reads+writes the DB).
  const userNotes = await load<typeof import("../src/services/user-notes.js")>("../src/services/user-notes.js");
  if (userNotes) put("user-notes/buildUserNoteTranslateHint", userNotes.buildUserNoteTranslateHint("uppsc"));

  // --- ingest/prompts.ts: the exam-bearing system prompts of the three ingest
  //     CLIs. They live in this side-effect-free module precisely so this
  //     harness never has to import explain.ts / syllabus.ts / pyq.ts, each of
  //     which ends in a bare unguarded top-level main().catch(...). NOTE: adding
  //     an argv guard to those files is NOT an acceptable alternative — see the
  //     module header, and CLAUDE.md's `_tmp_reembed.ts` self-trigger incident.
  const ingestPrompts = await load<typeof import("../src/ingest/prompts.js")>("../src/ingest/prompts.js");
  if (ingestPrompts) {
    put("ingest/supportSystem", ingestPrompts.supportSystem("uppsc"));
    put("ingest/explainSystem", ingestPrompts.explainSystem("uppsc"));
    put("ingest/buildStructurePaperSystem", ingestPrompts.buildStructurePaperSystem("uppsc"));
    put("ingest/buildNodeClassifySystem", ingestPrompts.buildNodeClassifySystem("uppsc"));
  }
}

async function collectAuditPrompts(): Promise<void> {
  // NOTE: ingest/explain.ts, ingest/syllabus.ts and ingest/pyq.ts are
  // DELIBERATELY NOT IMPORTED — each ends with a bare, unguarded top-level
  // `main().catch(...)` (no `if (process.argv[1].endsWith(...))` guard), so a
  // dynamic import would immediately run the real CLI: Supabase writes,
  // Anthropic batch jobs, and process.exit(1) on failure. Importing them would
  // violate this harness's "never call a model, never touch the DB" contract.
  // Their exam-bearing SYSTEM prompts now live in ingest/prompts.ts — a
  // side-effect-free sibling module this harness DOES import (see
  // collectPostRefactorAuditPrompts) — so they are covered without any argv
  // guard being added to a CLI entrypoint. What is left in those three files is
  // catalogued in __not_reachable_without_editing__ and carries no exam framing.
  const q = {
    id: "99999999-9999-4999-8999-999999999999",
    paper_code: "FIXTURE_PAPER",
    syllabus_node_id: "33333333-3333-4333-8333-333333333333",
    source_kind: "pyq",
    difficulty: "medium",
    year: 2022,
    stem_i18n: { en: "Fixture audited stem in English.", hi: "फिक्स्चर लेखापरीक्षित प्रश्न।" },
    options_i18n: [
      { key: "A", text_i18n: { en: "Alpha", hi: "अल्फा" } },
      { key: "B", text_i18n: { en: "Beta", hi: "बीटा" } },
      { key: "C", text_i18n: { en: "Gamma", hi: "गामा" } },
      { key: "D", text_i18n: { en: "Delta", hi: "डेल्टा" } },
    ],
    correct_option_key: "B",
    explanation_i18n: { en: "Fixture explanation arguing for beta.", hi: "फिक्स्चर व्याख्या।" },
    meta: null,
  };

  const resolve = await load<typeof import("../src/audit/resolve.js")>("../src/audit/resolve.js");
  if (resolve) {
    put("audit/SOLVE_SCHEMA", resolve.SOLVE_SCHEMA);
    // solveModel branches on difficulty, so the two params variants differ in
    // model AND in whether `effort` is present — both are live paths.
    put(
      "audit/buildSolveParams:haiku-grounded",
      messageParamsSnapshot(resolve.buildSolveParams(q as never, GROUNDING as never, "uppsc") as never),
    );
    put(
      "audit/buildSolveParams:sonnet-hard-ungrounded",
      messageParamsSnapshot(
        resolve.buildSolveParams({ ...q, difficulty: "hard" } as never, EMPTY_GROUNDING as never, "uppsc") as never,
      ),
    );
    // Newly reachable (multi-exam slice 2d): ESCALATE_SYSTEM was a module-private
    // const consumed only inside escalate(), which issues a live webResearch call.
    put("audit/escalateSystem", resolve.escalateSystem("uppsc"));
  }

  const consistency = await load<typeof import("../src/audit/consistency.js")>("../src/audit/consistency.js");
  if (consistency) {
    put("audit/ARGUED_SCHEMA", consistency.ARGUED_SCHEMA);
    put("audit/buildArguedParams:with-explanation", messageParamsSnapshot(consistency.buildArguedParams(q as never) as never));
    put(
      "audit/buildArguedParams:no-options-no-explanation",
      messageParamsSnapshot(consistency.buildArguedParams({ ...q, options_i18n: null, explanation_i18n: null } as never) as never),
    );
  }
}

// ===========================================================================
// The documented coverage gap — prompts this harness CANNOT reach without
// editing their source file. Kept IN the baseline (rather than only in a
// report) so it is versioned, reviewable, and shrinks visibly as the refactor
// exports each builder.
// ===========================================================================
const NOT_REACHABLE_WITHOUT_EDITING: Record<string, string> = {
  "ca/mcq-node-classify.ts::classifyPrelimsMcqNode content":
    "user content is a local const inside the exported async classifyPrelimsMcqNode(), built immediately before structuredJson(); only MCQ_NODE_CLASSIFY_SYSTEM and buildMcqNodeClassifySchema are exported",
  "services/question-explanation.ts::EXPLAIN_SCHEMA":
    "module-private const (no export keyword)",
  "services/question-explanation.ts::authorExplanation user content":
    "inline template literal written as the content: property of the structuredJson({...}) call inside the module-private authorExplanation() (its SYSTEM prompt is now covered: question-explanation/explainSystem)",
  "services/study-plan.ts::planGenerationSchema":
    "module-private function (no export keyword)",
  "services/micro-drills.ts::buildDrillEvaluationContent":
    "module-private function; its DrillSessionRow parameter type is module-private too",
  "services/micro-drills.ts::drillScoreSchema":
    "module-private function (no export keyword)",
  "services/user-notes.ts::convertAnswerToBody content+schema":
    "content and schema are still inline properties of the structuredJson({...}) argument inside the module-private convertAnswerToBody(); its SYSTEM prompt was extracted and IS now covered (user-notes/buildUserNoteConvertSystem)",
  "services/ocr/claude-vision-provider.ts::buildConfidenceSystem":
    "module-private function (no export keyword)",
  "services/ocr/claude-vision-provider.ts::transcribe user text + confidence schema":
    "inline template literal / object literal inside the provider's transcribe() method body",
  "lib/community-moderation.ts::screenText schema":
    "still an inline property of the single return structuredJson({...}) expression inside the module-private screenText(); its SYSTEM prompt was extracted and IS now covered (community-moderation/buildScreenSystem)",
  "lib/community-moderation.ts::screenThread 'Title:/Body:' framing":
    "inline template literal argument to screenText() inside the exported screenThread()",
  "routes/stream.ts::/stream/explain content":
    "the user content is still an inline literal inside an anonymous asyncHandler closure registered on streamRouter at module load; the SYSTEM prompt moved to services/question-explanation.ts and IS now covered (question-explanation/streamExplainSystem)",
  "ingest/explain.ts::SUPPORT_SCHEMA / EXPLAIN_SCHEMA / supportContent / explainContent":
    "module exports NOTHING (pure CLI entry) AND ends in a bare top-level main().catch(...) with no argv guard — dynamically importing it would run the real ingest (DB writes + Anthropic batch), so this harness must not import it at all. NOT exam-bearing: its two exam-parameterised SYSTEM prompts moved to the side-effect-free ingest/prompts.ts and ARE now covered (ingest/supportSystem, ingest/explainSystem); what remains here are fixed schemas and per-question user content with no exam framing",
  "ingest/syllabus.ts::NODE_SCHEMA + the structurePaper instructions + the vision OCR prompt":
    "module exports NOTHING and ends in a bare top-level main().catch(...) — not importable. NOT exam-bearing: its one exam-parameterised system prompt moved to ingest/prompts.ts and IS now covered (ingest/buildStructurePaperSystem)",
  "ingest/pyq.ts::buildExtractSystem / EXTRACT_SCHEMA / ANSWER_KEY_SCHEMA / CLASSIFY_SCHEMA + the answer-key inline prompt":
    "module exports NOTHING; buildExtractSystem is module-private and its ctx type (ExtractCtx) is unexported; the answer-key prompt is an anonymous inline property; and the file ends in a bare top-level main().catch(...) — not importable. Its one exam-parameterised system prompt (node classification) moved to ingest/prompts.ts and IS now covered (ingest/buildNodeClassifySystem)",
};

// ===========================================================================
// MENTOR PERSONA CACHE FLOOR
//
// `buildMentorPersona` is the ONLY cached segment on the mentor's generic doubt
// path, and it clears claude-sonnet-5's 1024-token minimum cacheable prefix by
// 22 tokens. MEASURED 2026-07-30 with messages.countTokens:
//
//     uppsc en → 2995 chars = 1046 tokens (+22 over the 1024 minimum)
//     uppsc hi → 3006 chars = 1055 tokens (+31)
//
// A second exam with TERSER mentor framing pushes the persona under 1024 and
// Anthropic silently stops caching it — no error, no failing field, just
// `cache_creation_input_tokens: 0` forever and the full persona re-billed on
// every doubt. This check is the cheap guard against that.
//
// WHY A CHARACTER FLOOR: this harness's determinism contract forbids network
// calls, so the real tokenizer is unavailable here. Characters are a proxy,
// calibrated from the measurements above (~2.86 chars/token for this text), so
// the 1024-token cliff sits near ~2932 chars. The floor is set just ABOVE that
// cliff so the check errs toward a false alarm rather than a silent miss, and
// the WARN band above it flags "thin margin, go measure" without failing.
//
// Devanagari tokenizes to FEWER chars per token, so a Hindi-heavy persona has
// more tokens than this proxy assumes — the error is in the safe direction.
// ===========================================================================
const MENTOR_PERSONA_MIN_CHARS = 2950;
/** Above the floor but thin enough that a real countTokens check is warranted. */
const MENTOR_PERSONA_WARN_CHARS = 3300;

/** Returns error strings (empty = pass); warnings are printed, not returned. */
async function checkMentorPersonaCacheFloor(): Promise<string[]> {
  const errors: string[] = [];
  const prompts = await load<typeof import("../src/services/mentor/prompts.js")>(
    "../src/services/mentor/prompts.js",
  );
  const cfg = await load<typeof import("../src/lib/exam-config.js")>("../src/lib/exam-config.js");
  if (!prompts || !cfg) return errors;

  for (const examCode of Object.keys(cfg.EXAM_CONFIGS)) {
    for (const locale of ["en", "hi"] as const) {
      let persona: string;
      try {
        persona = prompts.buildMentorPersona(examCode, locale);
      } catch {
        // requireAuthored throws for an exam whose mentor framing is still
        // UNAUTHORED (a seeded reference exam with no content). Nothing to
        // check — it cannot be served to a user either.
        continue;
      }
      const n = persona.length;
      if (n < MENTOR_PERSONA_MIN_CHARS) {
        errors.push(
          `mentor persona ${examCode}/${locale} is ${n} chars — below the ${MENTOR_PERSONA_MIN_CHARS}-char floor.\n` +
            `    This almost certainly falls under claude-sonnet-5's 1024-token minimum cacheable prefix,\n` +
            `    which makes services/mentor/index.ts's cache:true segment a SILENT no-op for this exam:\n` +
            `    every mentor doubt re-bills the full persona with no error anywhere.\n` +
            `    FIX: lengthen mentor.testingLens / mentor.platformFraming in lib/exam-config.ts\n` +
            `    (uppsc reference: 2995 chars = 1046 tokens), then confirm with messages.countTokens.`,
        );
      } else if (n < MENTOR_PERSONA_WARN_CHARS) {
        console.warn(
          `WARN  mentor persona ${examCode}/${locale} is ${n} chars — thin margin over the ` +
            `1024-token cache minimum (uppsc reference: 2995 chars = 1046 tokens, +22). ` +
            `Verify with messages.countTokens before shortening anything.`,
        );
      }
    }
  }
  return errors;
}

// ===========================================================================
// DIFF / WRITE
// ===========================================================================
function canonical(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

/** Sort ONLY the top-level keys. Nested key order is preserved deliberately:
 *  a JSON Schema's key order is part of the bytes the SDK serialises, so a
 *  reorder is a real change the diff should surface, not normalise away. */
function serialise(obj: Snapshot): string {
  const sorted: Snapshot = {};
  for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

function firstDiffLine(a: string, b: string): string {
  const al = a.split("\n");
  const bl = b.split("\n");
  const n = Math.max(al.length, bl.length);
  for (let i = 0; i < n; i++) {
    if (al[i] !== bl[i]) {
      const trunc = (s: string | undefined) =>
        s === undefined ? "(no such line)" : s.length > 160 ? `${s.slice(0, 160)}…` : s;
      return [`    @@ line ${i + 1} @@`, `    - ${trunc(al[i])}`, `    + ${trunc(bl[i])}`].join("\n");
    }
  }
  return "    (values differ only in trailing whitespace or length)";
}

// ===========================================================================
// `upsc` FIXTURES for the notes + misc config groups (authored 2026-07-31).
//
// WHY THIS BLOCK EXISTS. Every fixture elsewhere in this file pins the exam
// argument to "uppsc", so "N prompts byte-identical" is overwhelmingly a UPPSC
// regression check. When `EXAM_CONFIGS.upsc.notes` and most of `.misc` were
// authored, that made those 37 values the ONLY exam-config strings in the repo
// with ZERO machine coverage: authoring them is a pure no-op on the snapshot,
// so a later edit could reword any of them silently. These keys close that gap
// by assembling the SAME builders with `"upsc"`.
//
// They join the three pre-existing non-uppsc keys (the two
// `evaluation/buildImprovementsSystem:upsc-*` rubric shapes and
// `evaluation/buildModelAnswerSystem:upsc-ethics-en`) — see the note above them
// for why that pass added exactly those and invited more.
//
// FIXTURE REUSE IS DELIBERATE: every key below reuses the identical NOTES_NODE /
// CHAPTER_NODE / WEIGHTAGE / GROUNDING / RESEARCH_TEXT / WEB_SOURCES fixtures
// its uppsc twin uses, so a diff between the two snapshot values isolates the
// CONFIG difference and nothing else. The determinism contract is unchanged —
// these are the same fixed inline literals, and `getExamConfig` is a pure
// per-exam object lookup with no clock, random, network or DB.
//
// COVERAGE LIMITS, stated rather than implied. Six authored slots have no
// reachable pure builder and are NOT covered here — the same six are uncovered
// for uppsc too, so this is a pre-existing harness limit, not a gap introduced
// by the upsc authoring:
//   * notes.factEscalateUserFraming and misc.chapterTranslateDomainHint are
//     inline arguments inside `notes/chapter-generate.ts`'s model calls
//     (`translateBatch` builds its own system inline rather than through
//     `buildTranslateSystem`), and that module runs the real generation.
//   * misc.pyqTestTitlePrefix / prelimsMockTitlePrefix / mainsMockTitlePrefix /
//     shareCardBrand are USER-FACING bilingual labels, not prompts, so they are
//     out of this harness's scope by design (its subject is "every LLM prompt
//     string the API builds").
// All six were verified instead by building/printing them directly — see the
// authoring session's throwaway assembly script.
// ===========================================================================
async function collectUpscNotesAndMiscPrompts(): Promise<void> {
  // --- notes/prompts.ts
  const notes = await load<typeof import("../src/notes/prompts.js")>("../src/notes/prompts.js");
  if (notes) {
    put("notes/RESEARCH_SYSTEM_PROMPT:upsc", notes.RESEARCH_SYSTEM_PROMPT("upsc"));
    put("notes/buildResearchContent:upsc", notes.buildResearchContent(NOTES_NODE as never, "upsc"));
    // buildNoteGenParams' cached segment [0] carries FOUR authored slots
    // (facultyFraming, authorRelevanceFraming, stateAngleDirective,
    // pyqAnalysisFraming) and [1] carries groundingStoreLabel — so this single
    // key guards five values AND their placement either side of the cache
    // breakpoint (paramsSnapshot records segment boundaries + cache flags).
    put(
      "notes/buildNoteGenParams:upsc",
      paramsSnapshot(
        notes.buildNoteGenParams({
          node: NOTES_NODE,
          pyqs: [
            { year: 2022, stem_en: "Fixture past question one.", explanation_en: "Fixture explanation one." },
            { year: null, stem_en: "Fixture past question two.", explanation_en: null },
          ],
          weightage: WEIGHTAGE,
          ca: [{ title_en: "Fixture CA item", summary_en: "Fixture CA summary.", url: "https://example.invalid/ca" }],
          grounding: GROUNDING,
          research: RESEARCH_TEXT,
          sources: WEB_SOURCES,
          examCode: "upsc",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      ),
    );
    // The only reachable render of `stateAngleLabel` — the label the persisted
    // (and deliberately NOT renamed) `up_angle` block is shown under.
    const noteBody = {
      overview: "Fixture overview paragraph.",
      key_facts: [
        { fact: "Fixture fact one.", source_ref: "S1" },
        { fact: "Fixture fact two.", source_ref: null },
      ],
      up_angle: "Fixture state angle.",
      pyq_analysis: "Fixture past-question analysis.",
      mnemonics: ["Fixture mnemonic."],
      quick_revision: ["Fixture revision bullet."],
      further_reading: [{ title: "Fixture link", url: "https://example.invalid/read" }],
    };
    put(
      "notes/buildNoteCriticParams:upsc",
      paramsSnapshot(
        notes.buildNoteCriticParams({
          node: NOTES_NODE as never,
          content: { en: noteBody, hi: noteBody } as never,
          examCode: "upsc",
        }),
      ),
    );
  }

  // --- notes/chapter-prompts.ts
  const chapter = await load<typeof import("../src/notes/chapter-prompts.js")>("../src/notes/chapter-prompts.js");
  if (chapter) {
    put("notes/CHAPTER_RESEARCH_SYSTEM:upsc", chapter.CHAPTER_RESEARCH_SYSTEM("upsc"));
    put("notes/FACT_ESCALATE_SYSTEM:upsc", chapter.FACT_ESCALATE_SYSTEM("upsc"));
    put(
      "notes/buildChapterResearchContent:upsc",
      chapter.buildChapterResearchContent(CHAPTER_NODE as never, "upsc"),
    );
    put(
      "notes/buildOutlineParams:upsc",
      paramsSnapshot(
        chapter.buildOutlineParams({ node: CHAPTER_NODE as never, weightage: WEIGHTAGE, pyqs: [], examCode: "upsc" }),
      ),
    );
    // The chapter host of groundingStoreLabel phrases its sentence differently
    // from the notes host ("(X — ground your facts here)" vs "(from the X)"),
    // which is precisely why the value carries no leading article. Both hosts
    // are now pinned.
    const ctxBlock = chapter.chapterContextBlock({
      node: CHAPTER_NODE as never,
      weightage: WEIGHTAGE,
      grounding: GROUNDING as never,
      research: RESEARCH_TEXT,
      sources: WEB_SOURCES,
      pyqs: [],
      examCode: "upsc",
    });
    put("notes/chapterContextBlock:upsc", ctxBlock);
    // facultyFraming's SECOND host — one config value, two grammatical hosts
    // ("… writing STUDY NOTES for a topic" vs "… WRITING one section of a study
    // chapter"), so both are pinned.
    put(
      "notes/buildSectionParams:upsc",
      paramsSnapshot(
        chapter.buildSectionParams({
          context: ctxBlock,
          section: {
            id: "fixture-section",
            heading_en: "Fixture Section Heading",
            focus: "Fixture focus line.",
            planned_boxes: ["prelims_facts", "mains_angle"] as never,
            needs_diagram: true,
            diagram_hint: "a process flow",
          },
          allHeadings: ["Fixture Section Heading", "Other Section A", "Other Section B"],
          examCode: "upsc",
        }),
      ),
    );
    put(
      "notes/buildAuditParams:upsc",
      paramsSnapshot(
        chapter.buildAuditParams({
          facts: [
            { index: 0, claim: "Fixture decisive claim one." },
            { index: 1, claim: "Fixture decisive claim two." },
          ],
          context: ctxBlock,
          examCode: "upsc",
        }),
      ),
    );
  }

  // --- misc: one key per authored slot that has a reachable builder.
  const moderation = await load<typeof import("../src/lib/community-moderation.js")>(
    "../src/lib/community-moderation.js",
  );
  if (moderation) put("community-moderation/buildScreenSystem:upsc", moderation.buildScreenSystem("upsc"));

  const ocr = await load<typeof import("../src/services/ocr/claude-vision-provider.js")>(
    "../src/services/ocr/claude-vision-provider.js",
  );
  if (ocr) put("ocr/buildTranscribeSystem:upsc:en", ocr.buildTranscribeSystem("upsc", "en"));

  const drills = await load<typeof import("../src/services/micro-drills.js")>("../src/services/micro-drills.js");
  if (drills) {
    // Both branches: the intro/conclusion split is structural, but each renders
    // the same configured examiner persona, so one key per branch pins the
    // persona in both sentences it has to read correctly in.
    put("micro-drills/buildDrillEvaluationSystem:upsc:intro", drills.buildDrillEvaluationSystem("upsc", "intro"));
    put(
      "micro-drills/buildDrillEvaluationSystem:upsc:conclusion",
      drills.buildDrillEvaluationSystem("upsc", "conclusion"),
    );
  }

  const qexp = await load<typeof import("../src/services/question-explanation.js")>(
    "../src/services/question-explanation.js",
  );
  if (qexp) {
    put("question-explanation/explainSystem:upsc", qexp.explainSystem("upsc"));
    put("question-explanation/streamExplainSystem:upsc", qexp.streamExplainSystem("upsc"));
  }

  const plan = await load<typeof import("../src/services/study-plan.js")>("../src/services/study-plan.js");
  if (plan) {
    put("study-plan/buildPlanSystem:upsc", plan.buildPlanSystem("upsc"));
    // The no-display-name branch is the ONLY place `studyPlanAspirantFallback`
    // renders, so this fixture must keep displayName null.
    put(
      "study-plan/buildPlanContent:upsc:no-name",
      plan.buildPlanContent({
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        examCode: "upsc",
        hoursPerDay: 4,
        today: "2026-01-02",
        targetDate: "2026-12-06",
        displayName: null,
        targetExamYear: null,
        medium: "en",
        nextExam: null,
        weakSections: [],
        srsDueCount: 17,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any),
    );
  }

  const userNotes = await load<typeof import("../src/services/user-notes.js")>("../src/services/user-notes.js");
  if (userNotes) {
    put("user-notes/buildUserNoteConvertSystem:upsc:en", userNotes.buildUserNoteConvertSystem("upsc", "en"));
    put("user-notes/buildUserNoteTranslateHint:upsc", userNotes.buildUserNoteTranslateHint("upsc"));
  }

  const ingestPrompts = await load<typeof import("../src/ingest/prompts.js")>("../src/ingest/prompts.js");
  if (ingestPrompts) {
    put("ingest/supportSystem:upsc", ingestPrompts.supportSystem("upsc"));
    // explanationFraming's SECOND host — the batch ingest CLI's copy of the same
    // policy, whose surrounding sentence differs ("the VERIFIED correct option").
    put("ingest/explainSystem:upsc", ingestPrompts.explainSystem("upsc"));
  }

  const anthropic = await load<typeof import("../src/lib/anthropic.js")>("../src/lib/anthropic.js");
  const cfgMod = await load<typeof import("../src/lib/exam-config.js")>("../src/lib/exam-config.js");
  if (anthropic && cfgMod) {
    // DELIBERATELY DIFFERENT from the two uppsc `buildTranslateSystem` fixtures,
    // which pass a hardcoded literal hint. Reading the hint from the config is
    // what makes this key actually GUARD `misc.explanationTranslateDomainHint`
    // rather than merely document it — and it reproduces exactly what
    // `routes/stream.ts` assembles at its `translate()` call. Still fully
    // deterministic: a pure per-exam object lookup, no clock/random/network/DB.
    const hint = cfgMod.requireAuthored(
      cfgMod.getExamConfig("upsc").misc.explanationTranslateDomainHint,
      "upsc",
      "misc.explanationTranslateDomainHint",
    );
    put("anthropic/buildTranslateSystem:upsc:explanation-hint", anthropic.buildTranslateSystem("upsc", hint));
  }
}

async function main(): Promise<void> {
  await collectEvaluationPrompts();
  await collectMentorPrompts();
  await collectQgenPrompts();
  await collectCaPrompts();
  await collectNotesPrompts();
  await collectQuestionExplanationPrompts();
  await collectAuditPrompts();
  await collectSlice2dPrompts();
  await collectPostRefactorAuditPrompts();
  await collectUpscNotesAndMiscPrompts();

  snapshot.__unreachable__ = unreachable;
  snapshot.__not_reachable_without_editing__ = NOT_REACHABLE_WITHOUT_EDITING;

  const promptKeys = Object.keys(snapshot).filter((k) => !k.startsWith("__"));
  const write = process.argv.includes("--write");

  // Runs in BOTH modes on purpose: --write must not be a way to bless a persona
  // that has silently dropped below the prompt-cache minimum.
  const personaErrors = await checkMentorPersonaCacheFloor();
  for (const e of personaErrors) console.error(`CACHE-FLOOR  ${e}`);
  if (personaErrors.length > 0) process.exit(1);

  if (write) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
    writeFileSync(SNAPSHOT_FILE, serialise(snapshot), "utf8");
    console.log(`wrote ${promptKeys.length} prompt keys → ${SNAPSHOT_FILE}`);
    if (Object.keys(unreachable).length > 0) {
      console.log(`WARNING: ${Object.keys(unreachable).length} module(s) failed to import:`);
      for (const [m, why] of Object.entries(unreachable)) console.log(`  - ${m}: ${why}`);
    }
    return;
  }

  if (!existsSync(SNAPSHOT_FILE)) {
    console.error(`No baseline at ${SNAPSHOT_FILE}. Run with --write to create it.`);
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(SNAPSHOT_FILE, "utf8")) as Snapshot;
  const baseKeys = new Set(Object.keys(baseline));
  const curKeys = new Set(Object.keys(snapshot));

  const missing = [...baseKeys].filter((k) => !curKeys.has(k));
  const added = [...curKeys].filter((k) => !baseKeys.has(k));
  const changed: string[] = [];
  for (const k of [...baseKeys].filter((x) => curKeys.has(x))) {
    if (canonical(baseline[k]) !== canonical(snapshot[k])) changed.push(k);
  }

  for (const k of changed.sort()) {
    console.error(`CHANGED  ${k}`);
    console.error(firstDiffLine(canonical(baseline[k]), canonical(snapshot[k])));
  }
  for (const k of missing.sort()) console.error(`MISSING  ${k}  (in baseline, not produced now)`);
  for (const k of added.sort()) console.error(`NEW      ${k}  (produced now, not in baseline)`);

  const total = changed.length + missing.length + added.length;
  if (total > 0) {
    console.error(`\n${changed.length} changed, ${missing.length} missing, ${added.length} new — ${promptKeys.length} prompt keys checked.`);
    console.error("If the change is intentional, re-run with --write and review the diff in git.");
    process.exit(1);
  }

  console.log(`${promptKeys.length} prompts byte-identical`);
}

await main();
