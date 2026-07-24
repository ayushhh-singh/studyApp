import {
  crisisLevelRank,
  maxCrisisLevel,
  type SukoonCrisisAssessment,
  type SukoonCrisisLayer,
  type SukoonCrisisLevel,
} from "@neev/shared";
import { supabase } from "../../../lib/supabase.js";
import { logger } from "../../../lib/logger.js";
import { detectKeywordLevel } from "./keywordDetector.js";
import { classifyMessage } from "./classifier.js";

/**
 * The crisis-detection engine (F3 safety spine) — the ONE entry point the
 * future chat/voice pipelines call: `assessMessage(userId, text)`.
 *
 * It combines the two layers (final level = MAX of keyword + classifier),
 * writes a minimal, privacy-first event row (level + layer + time — never the
 * message text), and returns the anti-doom-loop `rate_limited` flag. The
 * classifier can only ever RAISE the level, never lower the deterministic
 * keyword verdict (see classifier.ts's fail-open contract).
 */

/** ≥ this many high/critical events inside the window trips the anti-doom-loop. */
const RATE_LIMIT_THRESHOLD = 3;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** high + critical are the "severe" tier the anti-doom-loop counts. */
const SEVERE_LEVELS: SukoonCrisisLevel[] = ["high", "critical"];

/** Count this user's high/critical events in the last 24h (defensive on error → 0). */
async function countRecentSevereEvents(userId: string): Promise<number> {
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count, error } = await supabase()
    .from("sukoon_crisis_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("level", SEVERE_LEVELS)
    .gte("created_at", since);
  if (error) {
    logger.warn({ error: error.message }, "sukoon crisis: severe-event count failed");
    return 0;
  }
  return count ?? 0;
}

/**
 * Persist one crisis event (best-effort). `level` is never "none" here (the
 * caller guards that), and `layer` is narrowed to the DB's keyword|classifier
 * constraint. A write failure is logged but never fails the assessment — what
 * the user sees must not depend on the audit log succeeding.
 */
async function logCrisisEvent(
  userId: string,
  level: Exclude<SukoonCrisisLevel, "none">,
  layer: "keyword" | "classifier",
): Promise<void> {
  const { error } = await supabase()
    .from("sukoon_crisis_events")
    .insert({ user_id: userId, level, layer });
  if (error) {
    logger.error({ error: error.message, level, layer }, "sukoon crisis: failed to log event");
  }
}

/**
 * Assess one user message. Returns the level, which layer decided it, a short
 * reason (never containing message text), and the `rate_limited` flag.
 *
 * `signal` (optional) aborts the classifier call if the caller disconnects.
 */
export async function assessMessage(
  userId: string,
  text: string,
  opts: { signal?: AbortSignal } = {},
): Promise<SukoonCrisisAssessment> {
  const keyword = detectKeywordLevel(text);

  // Skip the model call when the deterministic layer is already maxed out —
  // nothing can raise "critical", so we save a call and ~up-to-2s of latency.
  const classifier =
    keyword.level === "critical"
      ? { level: "none" as SukoonCrisisLevel, reason: "" }
      : await classifyMessage(text, { userId, signal: opts.signal });

  const level = maxCrisisLevel(keyword.level, classifier.level);

  // Which layer set the FINAL level: the classifier only "wins" when it strictly
  // exceeds the keyword layer; ties and keyword-led verdicts credit "keyword"
  // (the deterministic, auditable one). "none" → no layer decided anything.
  let layer: SukoonCrisisLayer = "none";
  let reason = "no crisis signal";
  if (level !== "none") {
    if (crisisLevelRank(classifier.level) > crisisLevelRank(keyword.level)) {
      layer = "classifier";
      reason = classifier.reason || "classifier signal";
    } else {
      layer = "keyword";
      reason = keyword.matched ? `keyword: ${keyword.matched}` : "keyword signal";
    }
    // Write the event BEFORE counting so a fresh high/critical is included in
    // the anti-doom-loop tally (the 3rd severe event in 24h trips the flag).
    await logCrisisEvent(userId, level, layer);
  }

  const rate_limited = (await countRecentSevereEvents(userId)) >= RATE_LIMIT_THRESHOLD;

  return { level, reason, layer, rate_limited };
}
