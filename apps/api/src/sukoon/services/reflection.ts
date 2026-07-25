/**
 * F4 AI Reflection — the on-request, per-entry warm reflection (blueprint F4).
 * Haiku, streamed (Sukoon's "AI responses stream" convention gives a calm
 * progressive reveal). Entitlement: Plus+ get a daily budget, free get 3
 * lifetime tries (services/entitlements). Charged only on SUCCESS: the route
 * checks the allowance pre-flight, streams, then persists + increments — so a
 * failed generation never burns a try.
 *
 * PRIVACY: the entry body is decrypted only to feed the model; it is never
 * logged. The generated reflection is persisted ENCRYPTED (persistReflection →
 * the 0081 RPC), same key as the body.
 */
import { HttpError } from "../../lib/http-error.js";
import { MODELS } from "../../lib/models.js";
import { streamText } from "../../lib/anthropic.js";
import { getReflectionUsage, consumeReflection } from "./entitlements.js";
import { getEntry, persistReflection } from "./journal.js";
import { REFLECTION_SYSTEM, buildReflectionContent } from "../prompts/reflection.js";
import { recordSukoonEvent } from "./analytics.js";

export interface ReflectionPlan {
  entryId: string;
  body: string;
}

/**
 * Pre-flight (runs BEFORE the SSE stream opens, so 4xx surface as JSON): the
 * entry must exist, own a body to reflect on, and the user must have an
 * allowance left. Returns the decrypted body to stream against.
 */
export async function planReflection(userId: string, entryId: string): Promise<ReflectionPlan> {
  const entry = await getEntry(userId, entryId); // 404s if not found / not owner
  const body = entry.body?.trim();
  if (!body) {
    throw new HttpError(400, "This entry has nothing written to reflect on yet");
  }
  const usage = await getReflectionUsage(userId);
  if (usage.remaining <= 0) {
    void recordSukoonEvent(userId, "cap_hit", { feature: "reflection", tier: usage.tier });
    throw new HttpError(402, "You've used all your reflections", { feature: "reflection_cap" });
  }
  return { entryId, body };
}

/**
 * Stream the reflection. Emits `delta` events as text arrives, then persists the
 * full text (encrypted) + increments usage, then the caller emits `done`. The
 * usage increment is best-effort AFTER a successful generation.
 */
export async function executeReflection(
  userId: string,
  plan: ReflectionPlan,
  emit: (event: string, data: unknown) => void,
  signal: AbortSignal,
): Promise<void> {
  const text = await streamText({
    model: MODELS.haiku, // haiku rejects the `effort` param — never pass it
    system: REFLECTION_SYSTEM,
    content: buildReflectionContent(plan.body),
    maxTokens: 400,
    purpose: "sukoon_journal_reflection",
    userId,
    onDelta: (t) => emit("delta", { text: t }),
    signal,
  });

  const reflection = text.trim();
  if (!reflection) throw new Error("empty reflection");

  await persistReflection(userId, plan.entryId, reflection);
  const { usage } = await consumeReflection(userId);
  emit("reflection_saved", { reflection_at: new Date().toISOString(), usage });
}
