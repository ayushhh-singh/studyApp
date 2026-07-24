import { structuredJson, type PromptSegment } from "../../../lib/anthropic.js";
import { MODELS } from "../../../lib/models.js";
import { logger } from "../../../lib/logger.js";
import { sukoonCrisisLevelSchema, type SukoonCrisisLevel } from "@neev/shared";

/**
 * Layer 2 of the crisis detector — a single claude-haiku-4-5 call that reads a
 * message for distress the keyword layer can't (euphemism, tone, exam-specific
 * despair, code-mixed phrasing) and returns `{level, reason}` via strict JSON
 * schema output. Cheap and fast; runs on EVERY user message.
 *
 * Contract with the engine:
 *  - Times out at 2s (CLASSIFIER_TIMEOUT_MS). On timeout OR any failure it
 *    returns `none` — the engine then falls back to the keyword result and
 *    (via `max`) never drops below it. So a slow/broken model can only ever
 *    FAIL OPEN toward the deterministic layer, never suppress a real match.
 *  - It classifies; it never lowers a keyword verdict. The engine takes the max.
 */

const CLASSIFIER_TIMEOUT_MS = 2000;

/**
 * The static instruction head, marked as a prompt-cache breakpoint. NOTE:
 * claude-haiku-4-5's minimum cacheable prefix is ~4096 tokens, and this head is
 * far shorter, so the cache is a structural no-op TODAY (no write, no read, no
 * cost either way) — the `cache:true` is here so that if this head grows (more
 * few-shot calibration, a longer rubric) it starts caching with no code change,
 * and to satisfy the blueprint's "prompt-cached head, always" intent.
 */
const CLASSIFIER_SYSTEM: PromptSegment[] = [
  {
    cache: true,
    text: [
      "You are a safety classifier for a wellness companion used by Indian exam aspirants.",
      "You read ONE user message (Hindi, English, Hinglish, or code-mixed) and rate its",
      "crisis level. You are NOT a therapist and you do not reply to the user — you output",
      "only a JSON verdict.",
      "",
      "Rate `level` as exactly one of:",
      '- "none": ordinary conversation, questions, mild everyday frustration.',
      '- "low": noticeable stress/anxiety/overwhelm, but coping (e.g. "so much pressure before mains").',
      '- "moderate": hopelessness, worthlessness, burnout, breaking down, "I can\'t do this anymore" —',
      "  NO mention of self-harm or death.",
      '- "high": passive death wish or self-harm ideation without an explicit plan',
      '  ("better off dead", "I want to disappear", self-harm urges), OR a bare self-harm',
      "  reference whose intent is ambiguous but concerning.",
      '- "critical": explicit intent, method, or plan to end one\'s life or seriously self-harm',
      '  ("I want to die", "khudkushi kar lunga", a described method).',
      "",
      "Judgment rules:",
      "- Bias toward safety: when genuinely torn between two levels, choose the HIGHER one.",
      "- Do NOT be fooled by euphemism or exam-despair phrasing (\"ab kuch nahi bacha\",",
      "  \"sab khatam\", \"I don't see a future\") — read the real meaning.",
      "- Do NOT over-escalate quotation, jokes explicitly flagged as jokes, reassurance",
      '  ("main theek hoon, mazak kar raha tha"), or discussion-about (news, an essay on',
      "  suicide prevention). Those are `none` unless real personal distress is also present.",
      "- `reason`: one short clause, in English, naming the signal you keyed on. No message text quoted.",
    ].join("\n"),
  },
];

const CLASSIFIER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    level: { type: "string", enum: sukoonCrisisLevelSchema.options },
    reason: { type: "string" },
  },
  required: ["level", "reason"],
} as const;

export interface ClassifierResult {
  level: SukoonCrisisLevel;
  reason: string;
}

/**
 * Classify one message. Never throws — a timeout or model error resolves to
 * `{ level: "none" }` so the engine can safely `max` it against the keyword
 * layer. `userId` (optional) attributes the llm_calls cost row.
 */
export async function classifyMessage(
  text: string,
  opts: { userId?: string; signal?: AbortSignal } = {},
): Promise<ClassifierResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CLASSIFIER_TIMEOUT_MS);
  // If the caller's own signal aborts (e.g. the SSE client disconnected), abort ours too.
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const out = await structuredJson<ClassifierResult>({
      model: MODELS.haiku, // haiku rejects the `effort` param — never pass it here
      system: CLASSIFIER_SYSTEM,
      content: `Classify this message:\n\n${text}`,
      // The output is tiny ({level, one-clause reason}); 256 leaves ample head-
      // room so a slightly long reason never truncates. A truncation would make
      // structuredJson throw → we'd fail open to "none", i.e. drop to the keyword
      // verdict — undesirable for a safety classifier, so keep this comfortable.
      schema: CLASSIFIER_SCHEMA,
      maxTokens: 256,
      purpose: "sukoon_crisis_classify",
      userId: opts.userId,
      signal: controller.signal,
    });
    // Defensive: the schema constrains this, but never trust a level we can't rank.
    const parsed = sukoonCrisisLevelSchema.safeParse(out.level);
    return {
      level: parsed.success ? parsed.data : "none",
      reason: typeof out.reason === "string" ? out.reason : "",
    };
  } catch (err) {
    // Timeout (abort) or any API error → fail open to `none`; the engine keeps
    // the keyword verdict. Logged at warn so a spike in classifier failures is
    // visible without failing the user's message.
    const aborted = controller.signal.aborted;
    logger.warn(
      { err: aborted ? "timeout" : err, timeoutMs: CLASSIFIER_TIMEOUT_MS },
      "sukoon crisis classifier unavailable; falling back to keyword layer",
    );
    return { level: "none", reason: aborted ? "classifier timeout" : "classifier error" };
  } finally {
    clearTimeout(timeout);
  }
}
