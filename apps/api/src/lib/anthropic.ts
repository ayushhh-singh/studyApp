/**
 * Shared Anthropic client + thin helpers used across the ingestion pipeline.
 *
 * The SDK reads ANTHROPIC_API_KEY from the environment (loaded via node's
 * --env-file=.env in the ingest npm scripts). All model ids come from
 * ./models.ts — never inline a model string here or at a call site.
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, estimateCostUsd, type ModelId } from "./models.js";
import { supabase } from "./supabase.js";
import { logger } from "./logger.js";

let client: Anthropic | null = null;

/** Usage/cost for a single Anthropic call, surfaced to callers via `onUsage`. */
export interface LlmUsage {
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

/**
 * A system-prompt segment. Set `cache: true` on a segment that is
 * byte-identical across many calls (e.g. a fixed rubric, or a shared
 * question+answer context reused by sibling calls) to mark an ephemeral
 * (5-minute) prompt-cache breakpoint after it. Cache hits require the exact
 * same segment text AND every segment before it — order matters.
 */
export interface PromptSegment {
  text: string;
  cache?: boolean;
}

type SystemParam = string | PromptSegment[];

function toSystemParam(system: SystemParam | undefined): string | Anthropic.TextBlockParam[] | undefined {
  if (system === undefined || typeof system === "string") return system;
  return system.map((seg) => ({
    type: "text" as const,
    text: seg.text,
    ...(seg.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

export function anthropic(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set (apps/api/.env)");
    }
    client = new Anthropic();
  }
  return client;
}

/**
 * Records one Anthropic call's usage/cost into llm_calls. Best-effort — a
 * logging failure never fails the caller's actual LLM request.
 */
async function recordLlmCall(opts: {
  model: ModelId;
  purpose: string;
  userId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): Promise<void> {
  const { error } = await supabase()
    .from("llm_calls")
    .insert({
      user_id: opts.userId ?? null,
      model: opts.model,
      purpose: opts.purpose,
      input_tokens: opts.inputTokens,
      output_tokens: opts.outputTokens,
      cache_read_tokens: opts.cacheReadTokens,
      cache_write_tokens: opts.cacheWriteTokens,
      cost_usd: estimateCostUsd(opts.model, opts.inputTokens, opts.outputTokens, opts.cacheReadTokens, opts.cacheWriteTokens),
    });
  if (error) logger.warn({ error, purpose: opts.purpose }, "failed to record llm_calls row");
}

/** Fire the optional per-call usage callback with tokens + estimated cost. */
function emitUsage(
  model: ModelId,
  message: Anthropic.Message,
  onUsage?: (usage: LlmUsage) => void,
): void {
  if (!onUsage) return;
  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  const cacheReadTokens = message.usage.cache_read_input_tokens ?? 0;
  const cacheWriteTokens = message.usage.cache_creation_input_tokens ?? 0;
  onUsage({
    model,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costUsd: estimateCostUsd(model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens),
  });
}

/**
 * Ask a model for a single JSON object matching `schema` (a JSON Schema).
 * Uses structured outputs (output_config.format) so the response is guaranteed
 * to parse. Streams so large max_tokens never hits an HTTP timeout.
 *
 * `content` is a full user-message content array so callers can mix text with
 * document/image blocks (e.g. a PDF for vision extraction). Pass `purpose`
 * (and `userId` for user-triggered calls) to log tokens + cost to llm_calls.
 */
export async function structuredJson<T>(opts: {
  model: ModelId;
  system?: SystemParam;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  purpose?: string;
  userId?: string;
  onUsage?: (usage: LlmUsage) => void;
  /** Abort the in-flight request (e.g. the SSE client disconnected). */
  signal?: AbortSignal;
}): Promise<T> {
  const stream = anthropic().messages.stream(
    {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 32000,
      ...(opts.system ? { system: toSystemParam(opts.system) } : {}),
      output_config: {
        ...(opts.effort ? { effort: opts.effort } : {}),
        format: {
          type: "json_schema",
          schema: opts.schema,
        },
      },
      messages: [{ role: "user", content: opts.content }],
    } as Anthropic.MessageStreamParams,
    opts.signal ? { signal: opts.signal } : undefined,
  );

  const message = await stream.finalMessage();
  emitUsage(opts.model, message, opts.onUsage);
  if (opts.purpose) {
    await recordLlmCall({
      model: opts.model,
      purpose: opts.purpose,
      userId: opts.userId,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    });
  }
  if (message.stop_reason === "refusal") {
    throw new Error(
      `Model refused (${message.stop_details?.category ?? "unknown"})`,
    );
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) {
    throw new Error(`Empty response (stop_reason=${message.stop_reason})`);
  }
  return JSON.parse(text) as T;
}

/**
 * Stream plain text from a model, invoking `onDelta` for each text chunk —
 * the typed wrapper future SSE endpoints (e.g. answer evaluation, doubt chat)
 * build on. Returns the full text and logs tokens + cost to llm_calls.
 */
export async function streamText(opts: {
  model: ModelId;
  system?: SystemParam;
  content: Anthropic.MessageParam["content"];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  purpose: string;
  userId?: string;
  onDelta?: (text: string) => void;
  onUsage?: (usage: LlmUsage) => void;
  /** Abort the in-flight request (e.g. the SSE client disconnected). */
  signal?: AbortSignal;
}): Promise<string> {
  const stream = anthropic().messages.stream(
    {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 8000,
      ...(opts.system ? { system: toSystemParam(opts.system) } : {}),
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      messages: [{ role: "user", content: opts.content }],
    } as Anthropic.MessageStreamParams,
    opts.signal ? { signal: opts.signal } : undefined,
  );

  stream.on("text", (delta) => opts.onDelta?.(delta));

  const message = await stream.finalMessage();
  emitUsage(opts.model, message, opts.onUsage);
  await recordLlmCall({
    model: opts.model,
    purpose: opts.purpose,
    userId: opts.userId,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  });
  if (message.stop_reason === "refusal") {
    throw new Error(
      `Model refused (${message.stop_details?.category ?? "unknown"})`,
    );
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Draft-translate a short piece of content between hi/en with claude-haiku-4-5.
 * Used to fill the missing language when only one side parsed cleanly. Callers
 * mark the result meta.machine_translated=true for human review.
 */
export async function translate(
  text: string,
  target: "hi" | "en",
  domainHint = "UPPSC exam-prep content",
): Promise<string> {
  const targetName = target === "hi" ? "Hindi (Devanagari)" : "English";
  const out = await structuredJson<{ translation: string }>({
    model: MODELS.haiku,
    system:
      `You translate ${domainHint} between Hindi and English for a UP PCS ` +
      `exam platform. Preserve technical/administrative terms accurately. ` +
      `Return ONLY the translation, no notes.`,
    content: `Translate the following into ${targetName}:\n\n${text}`,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { translation: { type: "string" } },
      required: ["translation"],
    },
    maxTokens: 2000,
  });
  return out.translation.trim();
}

/**
 * Batch-translate many short strings into `target` with claude-haiku-4-5 in a
 * few calls (deduped + chunked). Returns translations aligned to the input
 * order; blank inputs map to "". Used to regenerate a language that did not
 * parse cleanly (e.g. mojibake Devanagari from a legacy-font PDF).
 */
export async function translateBatch(
  texts: string[],
  target: "hi" | "en",
  domainHint = "UPPSC exam questions",
): Promise<string[]> {
  const targetName = target === "hi" ? "Hindi (Devanagari)" : "English";
  const uniq = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  const map = new Map<string, string>();
  const batchSize = 20;
  for (let i = 0; i < uniq.length; i += batchSize) {
    const batch = uniq.slice(i, i + batchSize);
    const numbered = batch.map((t, j) => `${j + 1}. ${t}`).join("\n");
    const out = await structuredJson<{ items: { id: number; text: string }[] }>({
      model: MODELS.haiku,
      system:
        `You translate ${domainHint} into ${targetName}. Preserve technical/` +
        `administrative terms and any numbering inside the text. Return one ` +
        `translation per input id.`,
      content:
        `Translate each numbered item into ${targetName}. Return the SAME ids:\n\n${numbered}`,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { id: { type: "integer" }, text: { type: "string" } },
              required: ["id", "text"],
            },
          },
        },
        required: ["items"],
      },
      maxTokens: 16000,
    });
    for (const it of out.items) {
      const src = batch[it.id - 1];
      if (src) map.set(src, it.text.trim());
    }
  }
  return texts.map((t) => map.get(t.trim()) ?? "");
}

export { MODELS };
