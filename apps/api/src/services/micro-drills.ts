/**
 * Micro-drills: short, targeted answer-writing practice against a single
 * rubric dimension (currently always structure_flow — practising just the
 * introduction or just the conclusion of a Mains answer, 80 words each).
 *
 * Deliberately independent of the flagship evaluation pipeline
 * (services/evaluation/*) — its own structuredJson call with its own inline
 * schema, so drill scoring can never regress answer evaluation.
 */
import type {
  BilingualText,
  DrillItem,
  DrillRecommendation,
  DrillSession,
  DrillType,
  RubricDimensionKey,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError, notFound } from "../lib/http-error.js";
import { questionVisibilityOrFilter } from "../lib/question-visibility.js";
import { assertMicroDrill } from "./entitlements.js";
import { MODELS, structuredJson } from "../lib/anthropic.js";
import { fetchRecentEvaluations, computeDimensionInsights } from "./profile-analytics.js";

const DRILL_WORD_LIMIT = 80;
/** Every drill currently practices the same dimension — intro/conclusion are both structure-practice. */
const DRILL_DIMENSION_KEY: RubricDimensionKey = "structure_flow";
/** How many recent drill sessions to look back through when picking fresh questions. */
const RECENT_DRILL_LOOKBACK = 10;

interface DrillSessionRow {
  id: string;
  user_id: string;
  drill_type: DrillType;
  dimension_key: RubricDimensionKey;
  status: "pending" | "complete";
  items: DrillItem[];
  overall_pct: number | null;
  created_at: string;
  completed_at: string | null;
}

const DRILL_COLUMNS = "id, user_id, drill_type, dimension_key, status, items, overall_pct, created_at, completed_at";

function mapDrillSession(row: DrillSessionRow): DrillSession {
  return {
    id: row.id,
    drill_type: row.drill_type,
    dimension_key: row.dimension_key,
    status: row.status,
    items: row.items,
    overall_pct: row.overall_pct === null ? null : Number(row.overall_pct),
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
}

async function fetchDrillSession(userId: string, sessionId: string): Promise<DrillSessionRow> {
  const { data, error } = await supabase()
    .from("drill_sessions")
    .select(DRILL_COLUMNS)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new HttpError(500, `drill session lookup failed: ${error.message}`);
  if (!data || (data as DrillSessionRow).user_id !== userId) throw notFound("Drill session not found");
  return data as DrillSessionRow;
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------
export async function getRecommendation(userId: string): Promise<DrillRecommendation> {
  const trend = await fetchRecentEvaluations(userId, 30);
  if (trend.length === 0) {
    return { recommended_type: null, weakest_dimension: null, has_enough_data: false };
  }
  const insights = computeDimensionInsights(trend);
  const weakest = insights.reduce((min, i) => (i.recent_avg_pct < min.recent_avg_pct ? i : min), insights[0]);

  if (weakest.dimension_key !== DRILL_DIMENSION_KEY) {
    return { recommended_type: null, weakest_dimension: weakest.dimension_key, has_enough_data: true };
  }

  // Weakest dimension is structure_flow (what drills practice) — recommend
  // whichever of intro/conclusion the user has drilled less recently.
  const { data: recentDrills, error } = await supabase()
    .from("drill_sessions")
    .select("drill_type, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_DRILL_LOOKBACK);
  if (error) throw new HttpError(500, `drill history lookup failed: ${error.message}`);

  const lastIntro = (recentDrills ?? []).find((d) => d.drill_type === "intro");
  const lastConclusion = (recentDrills ?? []).find((d) => d.drill_type === "conclusion");
  let recommended: DrillType = "intro";
  if (lastIntro && lastConclusion) {
    recommended = (lastIntro.created_at as string) <= (lastConclusion.created_at as string) ? "intro" : "conclusion";
  } else if (lastConclusion && !lastIntro) {
    recommended = "intro";
  } else if (lastIntro && !lastConclusion) {
    recommended = "conclusion";
  }

  return { recommended_type: recommended, weakest_dimension: weakest.dimension_key, has_enough_data: true };
}

// ---------------------------------------------------------------------------
// Create a drill session
// ---------------------------------------------------------------------------
function shuffle<T>(arr: T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function pickDrillQuestions(userId: string): Promise<{ id: string; stem_i18n: BilingualText }[]> {
  const { data: recentSessions, error: recentError } = await supabase()
    .from("drill_sessions")
    .select("items")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(RECENT_DRILL_LOOKBACK);
  if (recentError) throw new HttpError(500, `recent drill lookup failed: ${recentError.message}`);
  const excludeIds = new Set(
    (recentSessions ?? []).flatMap((s) => ((s.items as DrillItem[] | null) ?? []).map((i) => i.question_id)),
  );

  const { data: pool, error: poolError } = await supabase()
    .from("questions")
    .select("id, stem_i18n")
    .eq("type", "descriptive")
    .or(questionVisibilityOrFilter("catalog"))
    .limit(100);
  if (poolError) throw new HttpError(500, `descriptive question pool lookup failed: ${poolError.message}`);
  const poolRows = (pool ?? []) as { id: string; stem_i18n: BilingualText }[];

  let candidates = poolRows.filter((q) => !excludeIds.has(q.id));
  // Not enough fresh (undrilled-recently) questions — relax the exclusion
  // rather than block the feature outright.
  if (candidates.length < 3) candidates = poolRows;
  if (candidates.length < 3) {
    throw badRequest("Not enough published descriptive questions available for a drill yet");
  }
  return shuffle(candidates).slice(0, 3);
}

export async function createDrillSession(userId: string, drillType: DrillType): Promise<DrillSession> {
  await assertMicroDrill(userId); // Pro-only
  const questions = await pickDrillQuestions(userId);
  const items: DrillItem[] = questions.map((q) => ({
    question_id: q.id,
    question_stem_i18n: q.stem_i18n,
    word_limit: DRILL_WORD_LIMIT,
    response_text: null,
    score: null,
    justification_i18n: null,
  }));

  const { data, error } = await supabase()
    .from("drill_sessions")
    .insert({
      user_id: userId,
      drill_type: drillType,
      dimension_key: DRILL_DIMENSION_KEY,
      status: "pending",
      items,
    })
    .select(DRILL_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `drill session insert failed: ${error.message}`);
  return mapDrillSession(data as DrillSessionRow);
}

// ---------------------------------------------------------------------------
// Save responses
// ---------------------------------------------------------------------------
export async function saveDrillResponses(
  userId: string,
  sessionId: string,
  responses: { question_id: string; response_text: string }[],
): Promise<DrillSession> {
  const session = await fetchDrillSession(userId, sessionId);
  if (session.status !== "pending") {
    throw badRequest("This drill session has already been evaluated");
  }

  const itemByQuestionId = new Map(session.items.map((i) => [i.question_id, i]));
  for (const r of responses) {
    if (!itemByQuestionId.has(r.question_id)) {
      throw badRequest(`question_id ${r.question_id} is not part of this drill session`);
    }
  }

  const updatedItems = session.items.map((item) => {
    const response = responses.find((r) => r.question_id === item.question_id);
    return response ? { ...item, response_text: response.response_text } : item;
  });

  const { data, error } = await supabase()
    .from("drill_sessions")
    .update({ items: updatedItems })
    .eq("id", sessionId)
    .select(DRILL_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `drill responses update failed: ${error.message}`);
  return mapDrillSession(data as DrillSessionRow);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
export async function getDrillHistory(userId: string): Promise<DrillSession[]> {
  const { data, error } = await supabase()
    .from("drill_sessions")
    .select(DRILL_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new HttpError(500, `drill history query failed: ${error.message}`);
  return ((data ?? []) as DrillSessionRow[]).map(mapDrillSession);
}

export async function deleteDrillSession(userId: string, sessionId: string): Promise<void> {
  await fetchDrillSession(userId, sessionId); // ownership 404
  const { error } = await supabase().from("drill_sessions").delete().eq("id", sessionId).eq("user_id", userId);
  if (error) throw new HttpError(500, `drill session delete failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Evaluation — plan (pre-flight, before SSE opens) + execute
// ---------------------------------------------------------------------------
export type DrillEmit = (event: string, data: unknown) => void;

export type DrillEvaluationPlan =
  | { kind: "replay"; session: DrillSessionRow }
  | { kind: "run"; session: DrillSessionRow };

export async function planDrillEvaluation(userId: string, sessionId: string): Promise<DrillEvaluationPlan> {
  const session = await fetchDrillSession(userId, sessionId);
  // A completed session is the source of truth for "done": replay it rather
  // than ever re-billing the model, same contract as the main evaluation pipeline.
  if (session.status === "complete") return { kind: "replay", session };
  if (session.items.some((i) => i.response_text === null || i.response_text.trim() === "")) {
    throw badRequest("Please save a response for every item before evaluating this drill");
  }
  return { kind: "run", session };
}

function clampScore(n: number): number {
  return Math.min(10, Math.max(0, Math.round(n)));
}

interface DrillScorePass1Item {
  question_id: string;
  score: number;
  justification_hi: string;
  justification_en: string;
}

function buildDrillEvaluationSystem(drillType: DrillType): string {
  const part = drillType === "intro" ? "introduction" : "conclusion";
  return (
    `You are an examiner scoring UPPSC (UP PCS) Mains answer-writing practice. The student ` +
    `has written ONLY the ${part} of an answer (not the full answer) to each question, within an ` +
    `80-word limit. Score EACH item 0-10 purely on structure and flow of that ${part}: ` +
    (drillType === "intro"
      ? "does it clearly frame the question, set up the direction the answer will take, and read " +
        "as a strong, focused opening — not vague, generic, or a restatement of the question?"
      : "does it crisply sum up the answer's direction, offer a forward-looking or balanced closing " +
        "note, and read as a deliberate ending — not an abrupt stop or a new unexplained point?") +
    ` Score as an integer from 0 to 10 (never outside this range). Write a short (1-2 sentence) ` +
    `justification in BOTH Hindi (Devanagari) and English for each item. Return ONLY the requested ` +
    `JSON — no markdown, no extra commentary.`
  );
}

function buildDrillEvaluationContent(
  session: DrillSessionRow,
): string {
  return session.items
    .map(
      (item, i) =>
        `Item ${i + 1} (question_id: ${item.question_id})\n` +
        `Question: ${item.question_stem_i18n.en || item.question_stem_i18n.hi}\n` +
        `Student's ${session.drill_type} (word limit ${item.word_limit}):\n${item.response_text}\n`,
    )
    .join("\n---\n\n");
}

function drillScoreSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question_id: { type: "string" },
            score: { type: "integer" },
            justification_hi: { type: "string" },
            justification_en: { type: "string" },
          },
          required: ["question_id", "score", "justification_hi", "justification_en"],
        },
      },
    },
    required: ["items"],
  };
}

export async function executeDrillEvaluation(
  plan: Extract<DrillEvaluationPlan, { kind: "run" }>,
  emit: DrillEmit,
  signal?: AbortSignal,
): Promise<void> {
  const { session } = plan;
  emit("status", { stage: "scoring" });

  const pass1 = await structuredJson<{ items: DrillScorePass1Item[] }>({
    model: MODELS.sonnet,
    effort: "low",
    system: buildDrillEvaluationSystem(session.drill_type),
    content: buildDrillEvaluationContent(session),
    schema: drillScoreSchema(),
    maxTokens: 2000,
    purpose: "micro_drill_evaluation",
    userId: session.user_id,
    signal,
  });
  if (signal?.aborted) return;

  const scoreByQuestionId = new Map(pass1.items.map((i) => [i.question_id, i]));
  const scoredItems: DrillItem[] = session.items.map((item) => {
    const scored = scoreByQuestionId.get(item.question_id);
    if (!scored) return item;
    const score = clampScore(scored.score);
    const justification_i18n: BilingualText = { hi: scored.justification_hi, en: scored.justification_en };
    emit("item_score", { question_id: item.question_id, score, justification_i18n });
    return { ...item, score, justification_i18n };
  });

  const scoredValues = scoredItems.map((i) => i.score).filter((s): s is number => s !== null);
  const overallPct = scoredValues.length
    ? Math.round((scoredValues.reduce((s, v) => s + v, 0) / scoredValues.length) * 10 * 10) / 10
    : null;

  const { data, error } = await supabase()
    .from("drill_sessions")
    .update({
      items: scoredItems,
      overall_pct: overallPct,
      status: "complete",
      completed_at: new Date().toISOString(),
    })
    .eq("id", session.id)
    .select(DRILL_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `drill session persist failed: ${error.message}`);

  emit("done", { session: mapDrillSession(data as DrillSessionRow) });
}

/** Replay an already-complete drill session over the same event protocol. */
export function replayDrillEvaluation(session: DrillSessionRow, emit: DrillEmit): void {
  for (const item of session.items) {
    if (item.score !== null && item.justification_i18n) {
      emit("item_score", { question_id: item.question_id, score: item.score, justification_i18n: item.justification_i18n });
    }
  }
  emit("done", { session: mapDrillSession(session) });
}
