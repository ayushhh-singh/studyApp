/**
 * Shared Anthropic client + thin helpers used across the ingestion pipeline.
 *
 * The SDK reads ANTHROPIC_API_KEY from the environment (loaded via node's
 * --env-file=.env in the ingest npm scripts). All model ids come from
 * ./models.ts — never inline a model string here or at a call site.
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, type ModelId } from "./models.js";

let client: Anthropic | null = null;

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
 * Ask a model for a single JSON object matching `schema` (a JSON Schema).
 * Uses structured outputs (output_config.format) so the response is guaranteed
 * to parse. Streams so large max_tokens never hits an HTTP timeout.
 *
 * `content` is a full user-message content array so callers can mix text with
 * document/image blocks (e.g. a PDF for vision extraction).
 */
export async function structuredJson<T>(opts: {
  model: ModelId;
  system?: string;
  content: Anthropic.MessageParam["content"];
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
}): Promise<T> {
  const stream = anthropic().messages.stream({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 32000,
    ...(opts.system ? { system: opts.system } : {}),
    output_config: {
      ...(opts.effort ? { effort: opts.effort } : {}),
      format: {
        type: "json_schema",
        schema: opts.schema,
      },
    },
    messages: [{ role: "user", content: opts.content }],
  } as Anthropic.MessageStreamParams);

  const message = await stream.finalMessage();
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
      maxTokens: 8000,
    });
    for (const it of out.items) {
      const src = batch[it.id - 1];
      if (src) map.set(src, it.text.trim());
    }
  }
  return texts.map((t) => map.get(t.trim()) ?? "");
}

export { MODELS };
