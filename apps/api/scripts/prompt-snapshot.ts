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
  examCode: "fixture-exam",
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
  put("evaluation/buildImprovementsSystem:en", mod.buildImprovementsSystem("uppsc", "en"));
  put("evaluation/buildImprovementsSystem:hi", mod.buildImprovementsSystem("uppsc", "hi"));
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
  put("evaluation/buildModelAnswerUserContent:with-points", mod.buildModelAnswerUserContent(ctx(), pass1()));
  put(
    "evaluation/buildModelAnswerUserContent:no-points",
    mod.buildModelAnswerUserContent(ctx({ language: "hi" }), pass1({ reference_points: [], missed_key_points: [] })),
  );
}

async function collectMentorPrompts(): Promise<void> {
  const mod = await load<typeof import("../src/services/mentor/prompts.js")>("../src/services/mentor/prompts.js");
  if (!mod) return;

  put("mentor/buildMentorPersona:en", mod.buildMentorPersona("en"));
  put("mentor/buildMentorPersona:hi", mod.buildMentorPersona("hi"));
  put("mentor/buildTeacherPersona:en", mod.buildTeacherPersona("en"));
  put("mentor/buildTeacherPersona:hi", mod.buildTeacherPersona("hi"));
  put("mentor/buildRevisionCompressionSystem:en", mod.buildRevisionCompressionSystem("en"));
  put("mentor/buildRevisionCompressionSystem:hi", mod.buildRevisionCompressionSystem("hi"));
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
  put("qgen/fewShotBlock:with-examples", mod.fewShotBlock(FEW_SHOT as never));
  put("qgen/fewShotBlock:empty", mod.fewShotBlock([]));

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
    paramsSnapshot(mod.buildVerifyParams({ stemEn: mcq.stem_i18n.en, options: mcq.options, grounding: GROUNDING as never })),
  );
  put(
    "qgen/buildVerifyParams:ungrounded",
    paramsSnapshot(
      mod.buildVerifyParams({ stemEn: mcq.stem_i18n.en, options: mcq.options, grounding: EMPTY_GROUNDING as never }),
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
    put("ca/MCQ_NODE_CLASSIFY_SYSTEM", classify.MCQ_NODE_CLASSIFY_SYSTEM);
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
    put("notes/RESEARCH_SYSTEM_PROMPT", mod.RESEARCH_SYSTEM_PROMPT);
    put("notes/buildResearchContent:with-desc", mod.buildResearchContent(NOTES_NODE as never));
    put(
      "notes/buildResearchContent:no-desc-prelims",
      mod.buildResearchContent({ ...NOTES_NODE, stage: "prelims", description_i18n: null } as never),
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
        mod.buildNoteCriticParams({ node: NOTES_NODE as never, content: { en: noteBody, hi: noteBody } as never }),
      ),
    );
  }

  const chapter = await load<typeof import("../src/notes/chapter-prompts.js")>("../src/notes/chapter-prompts.js");
  if (!chapter) return;

  put("notes/CHAPTER_PROMPT_VERSION", chapter.CHAPTER_PROMPT_VERSION);
  put("notes/CHAPTER_RESEARCH_SYSTEM", chapter.CHAPTER_RESEARCH_SYSTEM);
  put("notes/FACT_ESCALATE_SYSTEM", chapter.FACT_ESCALATE_SYSTEM);
  put("notes/OUTLINE_SCHEMA", chapter.OUTLINE_SCHEMA);
  put("notes/SECTION_SCHEMA", chapter.SECTION_SCHEMA);
  put("notes/COHERENCE_SCHEMA", chapter.COHERENCE_SCHEMA);
  put("notes/AUDIT_SCHEMA", chapter.AUDIT_SCHEMA);

  put("notes/buildChapterResearchContent:full", chapter.buildChapterResearchContent(CHAPTER_NODE as never));
  put("notes/buildChapterResearchContent:bare", chapter.buildChapterResearchContent(CHAPTER_NODE_BARE as never));

  const PYQS = [
    { n: 1, id: "88888888-8888-4888-8888-888888888881", year: 2021, stem_en: "Fixture chapter PYQ one.", explanation_en: "Fixture reason." },
    { n: 2, id: "88888888-8888-4888-8888-888888888882", year: null, stem_en: "Fixture chapter PYQ two.", explanation_en: null },
  ];

  put(
    "notes/buildOutlineParams:full",
    paramsSnapshot(chapter.buildOutlineParams({ node: CHAPTER_NODE as never, weightage: WEIGHTAGE, pyqs: PYQS })),
  );
  put(
    "notes/buildOutlineParams:bare",
    paramsSnapshot(
      chapter.buildOutlineParams({ node: CHAPTER_NODE_BARE as never, weightage: WEIGHTAGE_EMPTY, pyqs: [] }),
    ),
  );

  const ctxBlockFull = chapter.chapterContextBlock({
    node: CHAPTER_NODE as never,
    weightage: WEIGHTAGE,
    grounding: GROUNDING as never,
    research: RESEARCH_TEXT,
    sources: WEB_SOURCES,
    pyqs: PYQS,
  });
  const ctxBlockBare = chapter.chapterContextBlock({
    node: CHAPTER_NODE_BARE as never,
    weightage: WEIGHTAGE_EMPTY,
    grounding: EMPTY_GROUNDING as never,
    research: "",
    sources: [],
    pyqs: [],
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
}

async function collectAuditPrompts(): Promise<void> {
  // NOTE: ingest/explain.ts, ingest/syllabus.ts and ingest/pyq.ts are
  // DELIBERATELY NOT IMPORTED — each ends with a bare, unguarded top-level
  // `main().catch(...)` (no `if (process.argv[1].endsWith(...))` guard), so a
  // dynamic import would immediately run the real CLI: Supabase writes,
  // Anthropic batch jobs, and process.exit(1) on failure. Importing them would
  // violate this harness's "never call a model, never touch the DB" contract.
  // ingest/series.ts and ca/deepdive.ts ARE import-safe but export no prompt
  // text at all. All four are catalogued in __not_reachable_without_editing__.
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
    put("audit/buildSolveParams:haiku-grounded", messageParamsSnapshot(resolve.buildSolveParams(q as never, GROUNDING as never) as never));
    put(
      "audit/buildSolveParams:sonnet-hard-ungrounded",
      messageParamsSnapshot(resolve.buildSolveParams({ ...q, difficulty: "hard" } as never, EMPTY_GROUNDING as never) as never),
    );
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
  "ca/prompts.ts::generateMcqs system+content+schema":
    "inline object-literal properties of the structuredJson({...}) call inside the exported async generateMcqs() — no identifier binds the text, so reading it requires issuing the model call",
  "ca/prompts.ts::generateMainsQuestion system+content+schema":
    "same — inline inside the exported async generateMainsQuestion(); the briefText builder is also a local const in that function body",
  "ca/mcq-node-classify.ts::classifyPrelimsMcqNode content":
    "user content is a local const inside the exported async classifyPrelimsMcqNode(), built immediately before structuredJson(); only MCQ_NODE_CLASSIFY_SYSTEM and buildMcqNodeClassifySchema are exported",
  "services/question-explanation.ts::EXPLAIN_SYSTEM":
    "module-private const (no export keyword)",
  "services/question-explanation.ts::EXPLAIN_SCHEMA":
    "module-private const (no export keyword)",
  "services/question-explanation.ts::authorExplanation user content":
    "inline template literal written as the content: property of the structuredJson({...}) call inside the module-private authorExplanation()",
  "services/study-plan.ts::buildPlanSystem":
    "module-private function (no export keyword); only caller is executeGeneratePlan(), which calls the model and writes the DB",
  "services/study-plan.ts::buildPlanContent":
    "module-private function (no export keyword)",
  "services/study-plan.ts::planGenerationSchema":
    "module-private function (no export keyword)",
  "services/micro-drills.ts::buildDrillEvaluationSystem":
    "module-private function (no export keyword); reaching it needs executeDrillEvaluation(), which calls the model and updates drill_sessions",
  "services/micro-drills.ts::buildDrillEvaluationContent":
    "module-private function; its DrillSessionRow parameter type is module-private too",
  "services/micro-drills.ts::drillScoreSchema":
    "module-private function (no export keyword)",
  "services/user-notes.ts::convertAnswerToBody system+content+schema":
    "no identifier at all — system, content and schema are inline properties of the structuredJson({...}) argument inside the module-private convertAnswerToBody()",
  "services/user-notes.ts::translateUserNote translate hint":
    "bare inline string-literal argument to translateBatch() inside the exported translateUserNote(), which also reads and writes the DB",
  "services/ocr/claude-vision-provider.ts::buildTranscribeSystem":
    "module-private function; only the claudeVisionProvider object is exported and reaching the text needs .transcribe(), which makes two live model calls",
  "services/ocr/claude-vision-provider.ts::buildConfidenceSystem":
    "module-private function (no export keyword)",
  "services/ocr/claude-vision-provider.ts::transcribe user text + confidence schema":
    "inline template literal / object literal inside the provider's transcribe() method body",
  "lib/community-moderation.ts::screenText system+schema":
    "no identifier at all — inline properties of the single return structuredJson({...}) expression inside the module-private screenText()",
  "lib/community-moderation.ts::screenThread 'Title:/Body:' framing":
    "inline template literal argument to screenText() inside the exported screenThread()",
  "routes/stream.ts::/stream/explain system+content":
    "inline literals inside an anonymous asyncHandler closure registered on streamRouter at module load; only streamRouter is exported, so reaching the text needs a live HTTP request",
  "audit/resolve.ts::ESCALATE_SYSTEM":
    "module-private const with no pure builder — only consumed inside the exported escalate(), which immediately issues a live webResearch() call (SOLVE_SYSTEM by contrast IS covered, via the pure exported buildSolveParams)",
  "ca/deepdive.ts::DEEP_DIVE_SYSTEM / DEEP_DIVE_SCHEMA / buildContext":
    "all module-private, and unlike audit/* there is no pure params builder — structuredParams() is called inside runDeepDives(), which first deletes draft rows from Supabase and then runs a sonnet batch",
  "ingest/explain.ts::SUPPORT_SYSTEM / SUPPORT_SCHEMA / EXPLAIN_SYSTEM / EXPLAIN_SCHEMA / supportContent / explainContent":
    "module exports NOTHING (pure CLI entry) AND ends in a bare top-level main().catch(...) at L269 with no argv guard — dynamically importing it would run the real ingest (DB writes + Anthropic batch), so this harness must not import it at all",
  "ingest/syllabus.ts::NODE_SCHEMA + the structurePaper system/instructions + the vision OCR prompt":
    "module exports NOTHING; the system/instructions are function-LOCAL consts inside structurePaper(), and the file ends in a bare top-level main().catch(...) at L428 — not importable",
  "ingest/pyq.ts::buildExtractSystem / EXTRACT_SCHEMA / ANSWER_KEY_SCHEMA / CLASSIFY_SCHEMA + the answer-key and classify inline prompts":
    "module exports NOTHING; buildExtractSystem is module-private and its ctx type (ExtractCtx) is unexported; the answer-key/classify prompts are anonymous inline properties; and the file ends in a bare top-level main().catch(...) at L815 — not importable",
  "ingest/series.ts::SERIES_SYSTEM / SERIES_SCHEMA":
    "module-private consts; the file IS import-safe (no top-level main) but exposes no prompt builder — detectBookletSeries() returns only a series letter and needs a real PDF plus a live vision call",
};

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

async function main(): Promise<void> {
  await collectEvaluationPrompts();
  await collectMentorPrompts();
  await collectQgenPrompts();
  await collectCaPrompts();
  await collectNotesPrompts();
  await collectQuestionExplanationPrompts();
  await collectAuditPrompts();

  snapshot.__unreachable__ = unreachable;
  snapshot.__not_reachable_without_editing__ = NOT_REACHABLE_WITHOUT_EDITING;

  const promptKeys = Object.keys(snapshot).filter((k) => !k.startsWith("__"));
  const write = process.argv.includes("--write");

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
