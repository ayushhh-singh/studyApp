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

/**
 * Raised by structuredJson (always) or streamText (when `retryOnTruncation`
 * is set) when a response hits stop_reason==="max_tokens" before it could
 * complete and a retry at a higher ceiling still truncates. For structuredJson
 * this is thrown BEFORE the JSON.parse attempt so callers (and logs) get a
 * clear, attributable error instead of a cryptic "Unterminated string in JSON
 * at position N" from parsing a truncated fragment.
 */
export class TruncatedResponseError extends Error {
  readonly purpose?: string;
  readonly model: ModelId;
  readonly requestedMaxTokens: number;

  constructor(opts: { purpose?: string; model: ModelId; requestedMaxTokens: number }) {
    super(
      `Anthropic response truncated at max_tokens=${opts.requestedMaxTokens} ` +
        `for model=${opts.model}${opts.purpose ? ` purpose=${opts.purpose}` : ""} — ` +
        `the call's default maxTokens is too low for this input`,
    );
    this.name = "TruncatedResponseError";
    this.purpose = opts.purpose;
    this.model = opts.model;
    this.requestedMaxTokens = opts.requestedMaxTokens;
  }
}

/**
 * Real output-token ceiling per model (see the claude-api skill's Models API
 * `max_tokens` field) — the retry in structuredJson never asks for more than
 * this regardless of how far the 1.5-2x bump would otherwise go.
 */
const MODEL_MAX_OUTPUT_TOKENS: Record<ModelId, number> = {
  "claude-sonnet-5": 128_000,
  "claude-haiku-4-5": 64_000,
};

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
 * logging failure never fails the caller's actual LLM request. Batch calls are
 * billed at 0.5x (Message Batches API discount); the flag halves the recorded
 * cost and tags meta.batch so cost:report can price the row correctly.
 */
async function recordLlmCall(opts: {
  model: ModelId;
  purpose: string;
  userId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  batch?: boolean;
}): Promise<void> {
  const base = estimateCostUsd(opts.model, opts.inputTokens, opts.outputTokens, opts.cacheReadTokens, opts.cacheWriteTokens);
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
      cost_usd: opts.batch ? base * BATCH_DISCOUNT : base,
      ...(opts.batch ? { meta: { batch: true } } : {}),
    });
  if (error) logger.warn({ error, purpose: opts.purpose }, "failed to record llm_calls row");
}

/** Message Batches API price multiplier (50% off standard token rates). */
export const BATCH_DISCOUNT = 0.5;

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

/** Shared structured-output options (streamed via structuredJson OR batched). */
export interface StructuredParams {
  model: ModelId;
  system?: SystemParam;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}

/**
 * Build the Messages-API params for a structured-JSON call. Shared by the
 * streaming path (structuredJson) and the Message Batches path (runBatch) so
 * both produce byte-identical prompts — required for prompt-cache hits across
 * the two.
 */
export function structuredParams(opts: StructuredParams): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 32000,
    ...(opts.system ? { system: toSystemParam(opts.system) } : {}),
    output_config: {
      ...(opts.effort ? { effort: opts.effort } : {}),
      format: { type: "json_schema", schema: opts.schema },
    },
    messages: [{ role: "user", content: opts.content }],
  } as Anthropic.MessageCreateParamsNonStreaming;
}

/** Concatenated text of a message's text blocks. */
function messageText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Ask a model for a single JSON object matching `schema` (a JSON Schema).
 * Uses structured outputs (output_config.format) so the response is guaranteed
 * to parse. Streams so large max_tokens never hits an HTTP timeout.
 *
 * `content` is a full user-message content array so callers can mix text with
 * document/image blocks (e.g. a PDF for vision extraction). Pass `purpose`
 * (and `userId` for user-triggered calls) to log tokens + cost to llm_calls.
 *
 * On stop_reason==="max_tokens" (a truncated response — this is checked
 * BEFORE the JSON.parse attempt, since parsing a cut-off fragment throws a
 * cryptic "Unterminated string" error that gives no hint it was a token-limit
 * issue), retries ONCE with maxTokens raised ~1.75x, capped at the model's
 * real output ceiling (MODEL_MAX_OUTPUT_TOKENS). If the retry also truncates,
 * throws TruncatedResponseError rather than looping forever — that's a signal
 * this call's default maxTokens is genuinely too low for its typical input,
 * not a one-off fluke, and both attempts' token counts are logged so it's
 * visible in cost:report.
 */
export async function structuredJson<T>(opts: StructuredParams & {
  purpose?: string;
  userId?: string;
  onUsage?: (usage: LlmUsage) => void;
  /** Abort the in-flight request (e.g. the SSE client disconnected). */
  signal?: AbortSignal;
}): Promise<T> {
  let attemptMaxTokens = opts.maxTokens ?? 32000;

  for (let attempt = 0; attempt < 2; attempt++) {
    const stream = anthropic().messages.stream(
      structuredParams({ ...opts, maxTokens: attemptMaxTokens }) as Anthropic.MessageStreamParams,
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
    if (message.stop_reason === "max_tokens") {
      const ceiling = MODEL_MAX_OUTPUT_TOKENS[opts.model] ?? attemptMaxTokens;
      const retryMaxTokens = Math.min(Math.round(attemptMaxTokens * 1.75), ceiling);
      if (attempt === 0 && retryMaxTokens > attemptMaxTokens) {
        logger.warn(
          { purpose: opts.purpose, model: opts.model, maxTokens: attemptMaxTokens, retryMaxTokens },
          "structuredJson truncated at max_tokens; retrying once with a higher ceiling",
        );
        attemptMaxTokens = retryMaxTokens;
        continue;
      }
      logger.warn(
        { purpose: opts.purpose, model: opts.model, maxTokens: attemptMaxTokens },
        "structuredJson truncated at max_tokens on the retry too; giving up",
      );
      throw new TruncatedResponseError({ purpose: opts.purpose, model: opts.model, requestedMaxTokens: attemptMaxTokens });
    }
    const text = messageText(message);
    if (!text.trim()) {
      throw new Error(`Empty response (stop_reason=${message.stop_reason})`);
    }
    return JSON.parse(text) as T;
  }
  // Unreachable — the loop above always returns or throws — but keeps TS happy.
  throw new TruncatedResponseError({ purpose: opts.purpose, model: opts.model, requestedMaxTokens: attemptMaxTokens });
}

// ---------------------------------------------------------------------------
// Message Batches API — 50% cheaper async processing (lib/anthropic.ts is the
// one place that talks to it). Used by the qgen nightly top-up; interactive
// runs stay synchronous on structuredJson. Results arrive in ANY order, so
// everything keys off custom_id, never position.
// ---------------------------------------------------------------------------
export interface BatchRequest {
  customId: string;
  params: Anthropic.MessageCreateParamsNonStreaming;
  /** llm_calls purpose for this request's usage row (per-request so a mixed-stage batch logs correctly). */
  purpose: string;
  userId?: string;
}

export interface BatchItemResult {
  customId: string;
  /** true when the request succeeded and returned parseable text. */
  ok: boolean;
  /** Concatenated text blocks (JSON.parse-able for structured requests); "" when !ok. */
  text: string;
  error?: string;
  usage?: LlmUsage;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Submit all requests as one Message Batch, poll to completion, and collect
 * results keyed by custom_id. Each succeeded result's usage is logged to
 * llm_calls at the batch (0.5x) rate and surfaced via `onUsage`.
 *
 * Poll cadence is coarse (batches take minutes, not seconds); this is only ever
 * called from the nightly top-up job, never a request handler.
 */
export async function runBatch(
  requests: BatchRequest[],
  opts: {
    pollMs?: number;
    /** Called after each poll with the batch's request_counts, for CLI progress. */
    onPoll?: (counts: { processing: number; succeeded: number; errored: number; canceled: number; expired: number }) => void;
    onUsage?: (usage: LlmUsage) => void;
  } = {},
): Promise<Map<string, BatchItemResult>> {
  const out = new Map<string, BatchItemResult>();
  if (requests.length === 0) return out;

  const byId = new Map(requests.map((r) => [r.customId, r]));
  const batch = await anthropic().messages.batches.create({
    requests: requests.map((r) => ({ custom_id: r.customId, params: r.params })),
  });

  const pollMs = opts.pollMs ?? 15_000;
  // Anthropic guarantees a batch ends within 24h; cap polling well past that so
  // a stuck/never-terminal status fails the (unattended) nightly job loudly
  // instead of looping forever.
  const maxPolls = Math.ceil((26 * 60 * 60 * 1000) / pollMs);
  let status = batch.processing_status;
  let polls = 0;
  while (status !== "ended") {
    if (++polls > maxPolls) {
      throw new Error(`Batch ${batch.id} did not end after ${polls} polls (~26h); aborting.`);
    }
    await sleep(pollMs);
    const fresh = await anthropic().messages.batches.retrieve(batch.id);
    status = fresh.processing_status;
    opts.onPoll?.(fresh.request_counts);
  }

  const results = await anthropic().messages.batches.results(batch.id);
  for await (const entry of results) {
    const req = byId.get(entry.custom_id);
    if (entry.result.type === "succeeded") {
      const message = entry.result.message;
      const usage: LlmUsage = {
        model: (req?.params.model as ModelId) ?? MODELS.haiku,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
        costUsd:
          estimateCostUsd(
            (req?.params.model as ModelId) ?? MODELS.haiku,
            message.usage.input_tokens,
            message.usage.output_tokens,
            message.usage.cache_read_input_tokens ?? 0,
            message.usage.cache_creation_input_tokens ?? 0,
          ) * BATCH_DISCOUNT,
      };
      opts.onUsage?.(usage);
      if (req) {
        await recordLlmCall({
          model: usage.model,
          purpose: req.purpose,
          userId: req.userId,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheWriteTokens: usage.cacheWriteTokens,
          batch: true,
        });
      }
      const refused = message.stop_reason === "refusal";
      out.set(entry.custom_id, {
        customId: entry.custom_id,
        ok: !refused,
        text: refused ? "" : messageText(message),
        error: refused ? "model refused" : undefined,
        usage,
      });
    } else {
      const err =
        entry.result.type === "errored"
          ? entry.result.error.error?.message ?? "errored"
          : entry.result.type; // canceled | expired
      out.set(entry.custom_id, { customId: entry.custom_id, ok: false, text: "", error: err });
    }
  }
  return out;
}

/**
 * Stream plain text from a model, invoking `onDelta` for each text chunk —
 * the typed wrapper future SSE endpoints (e.g. answer evaluation, doubt chat)
 * build on. Returns the full text and logs tokens + cost to llm_calls.
 *
 * `retryOnTruncation` (default false) opts into structuredJson's retry
 * pattern: on stop_reason==="max_tokens", retry ONCE with maxTokens raised
 * ~1.75x (capped at the model's real output ceiling), throwing
 * TruncatedResponseError if the retry also truncates. Each attempt is logged
 * to llm_calls independently, exactly as structuredJson does. Leave this off
 * (the default) for any caller that streams to a live consumer via `onDelta`
 * — a retry restarts the request from scratch, which would replay a
 * truncated attempt's text followed by a full duplicate re-stream to whoever
 * is watching. Only opt in for a caller with no `onDelta`, or one that's
 * genuinely fine restarting a fresh stream (e.g. a background transcription
 * job with no live listener).
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
  /** See the function doc above — default false, unsafe to combine with a live `onDelta` consumer. */
  retryOnTruncation?: boolean;
}): Promise<string> {
  if (opts.retryOnTruncation && opts.onDelta) {
    // Fail fast at call time rather than shipping a footgun that only shows
    // up in production the first time a truncation actually happens — a
    // retry restarts the request, which would replay a truncated attempt's
    // text into onDelta followed by a full duplicate re-stream.
    throw new Error(
      "streamText: retryOnTruncation and onDelta cannot be combined — retrying restarts " +
        "the stream from scratch, which would double-emit text to a live delta consumer",
    );
  }
  let attemptMaxTokens = opts.maxTokens ?? 8000;
  const maxAttempts = opts.retryOnTruncation ? 2 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stream = anthropic().messages.stream(
      {
        model: opts.model,
        max_tokens: attemptMaxTokens,
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
    if (message.stop_reason === "max_tokens" && opts.retryOnTruncation) {
      const ceiling = MODEL_MAX_OUTPUT_TOKENS[opts.model] ?? attemptMaxTokens;
      const retryMaxTokens = Math.min(Math.round(attemptMaxTokens * 1.75), ceiling);
      if (attempt === 0 && retryMaxTokens > attemptMaxTokens) {
        logger.warn(
          { purpose: opts.purpose, model: opts.model, maxTokens: attemptMaxTokens, retryMaxTokens },
          "streamText truncated at max_tokens; retrying once with a higher ceiling",
        );
        attemptMaxTokens = retryMaxTokens;
        continue;
      }
      logger.warn(
        { purpose: opts.purpose, model: opts.model, maxTokens: attemptMaxTokens },
        "streamText truncated at max_tokens on the retry too; giving up",
      );
      throw new TruncatedResponseError({ purpose: opts.purpose, model: opts.model, requestedMaxTokens: attemptMaxTokens });
    }
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  }
  // Unreachable — the loop above always returns or throws — but keeps TS happy.
  throw new TruncatedResponseError({ purpose: opts.purpose, model: opts.model, requestedMaxTokens: attemptMaxTokens });
}

/**
 * Stream plain text from a multi-turn conversation (a `messages` array), with
 * an optional cached system prompt — the mentor chat builds on this. Unlike
 * streamText (single user turn), this passes the full message history so a
 * back-and-forth doubt thread stays coherent. Put stable content (persona,
 * learner profile) in `system` segments marked `cache:true` so it's billed at
 * cache-read rates across a thread; keep the per-message retrieved context and
 * question in the last user turn (after the cache breakpoint).
 */
export async function streamChat(opts: {
  model: ModelId;
  system?: SystemParam;
  messages: Anthropic.MessageParam[];
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  purpose: string;
  userId?: string;
  onDelta?: (text: string) => void;
  onUsage?: (usage: LlmUsage) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const stream = anthropic().messages.stream(
    {
      model: opts.model,
      max_tokens: opts.maxTokens ?? 4000,
      ...(opts.system ? { system: toSystemParam(opts.system) } : {}),
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
      messages: opts.messages,
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
    throw new Error(`Model refused (${message.stop_details?.category ?? "unknown"})`);
  }
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Web research (server-side web_search tool) — for grounding study notes on
// CURRENT facts (UP schemes, latest data) that our local bank can't supply.
// Returns the model's own-words synthesis PLUS the source list it cited, so
// every externally-sourced fact in a note can carry a link out. This is the
// ONE place the Anthropic tools API is used.
// ---------------------------------------------------------------------------

/** A web source surfaced by the web_search tool, for a note's `sources` list. */
export interface WebSource {
  id: string;
  title: string;
  url: string;
}

export interface WebResearchResult {
  /** The model's synthesised text (its own words), citing sources as [S1], [S2], … */
  text: string;
  sources: WebSource[];
}

/**
 * Run a web-search-grounded research turn with claude-sonnet-5. The model may
 * issue several searches (server-side); we drive the tool loop to completion
 * (handling `pause_turn`) and collect every `web_search_result` it saw into a
 * deduped, id-stamped source list. Degrades to `{text:"", sources:[]}` on any
 * error so note generation can proceed ungrounded-by-web rather than fail.
 *
 * `web_search_20260209` (dynamic filtering) is supported on claude-sonnet-5;
 * see the claude-api skill. No beta header required.
 */
export async function webResearch(opts: {
  system?: SystemParam;
  content: string;
  /** Cap on server-side searches (bounds cost/latency). */
  maxUses?: number;
  maxTokens?: number;
  purpose: string;
  userId?: string;
  onUsage?: (usage: LlmUsage) => void;
  signal?: AbortSignal;
}): Promise<WebResearchResult> {
  const model = MODELS.sonnet;
  const tools = [
    { type: "web_search_20260209", name: "web_search", max_uses: opts.maxUses ?? 5 },
  ];

  try {
    let messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.content }];
    const sourcesByUrl = new Map<string, WebSource>();
    const textParts: string[] = [];
    let inTok = 0;
    let outTok = 0;
    let cacheR = 0;
    let cacheW = 0;

    // Server-side tool loops can end a turn with `pause_turn`; re-send to resume.
    for (let hop = 0; hop < 8; hop++) {
      const message = (await anthropic().messages.create(
        {
          model,
          max_tokens: opts.maxTokens ?? 6000,
          ...(opts.system ? { system: toSystemParam(opts.system) } : {}),
          tools: tools as unknown as Anthropic.ToolUnion[],
          messages,
        } as Anthropic.MessageCreateParamsNonStreaming,
        opts.signal ? { signal: opts.signal } : undefined,
      )) as Anthropic.Message;

      inTok += message.usage.input_tokens;
      outTok += message.usage.output_tokens;
      cacheR += message.usage.cache_read_input_tokens ?? 0;
      cacheW += message.usage.cache_creation_input_tokens ?? 0;

      for (const block of message.content as unknown[]) {
        const b = block as { type: string; text?: string; content?: unknown };
        if (b.type === "text" && b.text) textParts.push(b.text);
        if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
          for (const r of b.content as { type?: string; url?: string; title?: string }[]) {
            if (r.url && !sourcesByUrl.has(r.url)) {
              sourcesByUrl.set(r.url, {
                id: `S${sourcesByUrl.size + 1}`,
                title: r.title || r.url,
                url: r.url,
              });
            }
          }
        }
      }

      if (message.stop_reason === "refusal") break;
      if (message.stop_reason === "pause_turn") {
        messages = [...messages, { role: "assistant", content: message.content }];
        continue;
      }
      break; // end_turn / max_tokens / tool loop done
    }

    const usage: LlmUsage = {
      model,
      inputTokens: inTok,
      outputTokens: outTok,
      cacheReadTokens: cacheR,
      cacheWriteTokens: cacheW,
      costUsd: estimateCostUsd(model, inTok, outTok, cacheR, cacheW),
    };
    opts.onUsage?.(usage);
    await recordLlmCall({
      model,
      purpose: opts.purpose,
      userId: opts.userId,
      inputTokens: inTok,
      outputTokens: outTok,
      cacheReadTokens: cacheR,
      cacheWriteTokens: cacheW,
    });

    return { text: textParts.join("\n").trim(), sources: [...sourcesByUrl.values()] };
  } catch (err) {
    logger.warn({ err, purpose: opts.purpose }, "webResearch failed; degrading to no web grounding");
    return { text: "", sources: [] };
  }
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
 *
 * `purpose`/`userId`/`onUsage` are additive passthroughs to structuredJson
 * (previously omitted here, so every translateBatch call was invisible to
 * llm_calls/cost:report) — pass them when a caller cares about attributing
 * this spend, e.g. per-evaluation lazy translation. Omit for the original
 * ingestion-time use (untracked, as before).
 */
export async function translateBatch(
  texts: string[],
  target: "hi" | "en",
  domainHint = "UPPSC exam questions",
  opts?: { purpose?: string; userId?: string; onUsage?: (usage: LlmUsage) => void },
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
      purpose: opts?.purpose,
      userId: opts?.userId,
      onUsage: opts?.onUsage,
    });
    for (const it of out.items) {
      const src = batch[it.id - 1];
      if (src) map.set(src, it.text.trim());
    }
  }
  return texts.map((t) => map.get(t.trim()) ?? "");
}

export { MODELS };
