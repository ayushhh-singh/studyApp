/**
 * Sukoon F7 — Guided Journeys ADMIN content queue: paste/upload a whole journey
 * document → validate → preview (bilingual, since every content node already
 * carries _hi + _en) → publish (bumps `version`) / unpublish. Mirrors the
 * Notes/chapter admin pattern (validate-then-persist, `version` bumped on every
 * content write) but simpler — journeys have no fact-audit/needs_review gate,
 * an admin decides publish-readiness directly.
 *
 * "Reuse the Neev admin pattern" (session brief) means requireAdmin/is_admin —
 * see routes/admin.ts, which imports the SAME requireAdmin used by Neev's own
 * /admin/* routes (apps/api/src/lib/admin.ts). Everything else here (schema,
 * services, routes) stays inside apps/api/src/sukoon/ per the module's
 * self-containment rule.
 */
import {
  sukoonJourneyContentSchema,
  type SukoonJourneyAdminSummary,
  type SukoonJourneyContent,
  type SukoonJourneyValidationIssue,
} from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError, badRequest, notFound } from "../../lib/http-error.js";
import {
  JOURNEY_COLUMNS,
  getJourneyRowBySlug,
  listStepsForJourney,
  toStepContent,
  type JourneyRow,
} from "../lib/journey-store.js";

function toAdminSummary(row: JourneyRow, totalSteps: number): SukoonJourneyAdminSummary {
  return {
    id: row.id,
    slug: row.slug,
    title_hi: row.title_hi,
    title_en: row.title_en,
    description_hi: row.description_hi,
    description_en: row.description_en,
    days: row.days,
    total_steps: totalSteps,
    premium: row.premium,
    version: row.version,
    published: row.published,
  };
}

/** GET /admin/journeys — every journey (draft + published), for the queue's
 *  list view. Small, fixed-size catalog (operator-authored content), so a
 *  per-journey step-count query is simple and cheap rather than a join. */
export async function listAdminJourneys(): Promise<SukoonJourneyAdminSummary[]> {
  const { data, error } = await supabase()
    .from("sukoon_journeys")
    .select(JOURNEY_COLUMNS)
    .order("slug", { ascending: true });
  if (error) throw new HttpError(500, `sukoon admin journeys list failed: ${error.message}`);
  const rows = (data as unknown as JourneyRow[]) ?? [];
  return Promise.all(
    rows.map(async (row) => toAdminSummary(row, (await listStepsForJourney(row.id)).length)),
  );
}

/** GET /admin/journeys/:slug — the full content document, reconstructed from
 *  the DB (round-trips through sukoonJourneyContentSchema so what an admin
 *  re-opens to edit is exactly what a fresh upload would validate as). */
export async function getAdminJourneyDetail(
  slug: string,
): Promise<{ journey: SukoonJourneyAdminSummary; content: SukoonJourneyContent }> {
  const row = await getJourneyRowBySlug(slug);
  if (!row) throw notFound("Journey not found");
  const steps = await listStepsForJourney(row.id);

  const byDay = new Map<number, SukoonJourneyContent["days"][number]["steps"]>();
  for (const s of steps) {
    const list = byDay.get(s.day) ?? [];
    list.push(toStepContent(s));
    byDay.set(s.day, list);
  }
  const days = Array.from(byDay.entries())
    .sort(([a], [b]) => a - b)
    .map(([day, stepsForDay]) => ({ day, steps: stepsForDay }));

  const content = sukoonJourneyContentSchema.parse({
    slug: row.slug,
    title_hi: row.title_hi,
    title_en: row.title_en,
    description_hi: row.description_hi,
    description_en: row.description_en,
    premium: row.premium,
    days,
  });
  return { journey: toAdminSummary(row, steps.length), content };
}

/** Structured (path + message) issues for the admin preview UI — mirrors
 *  `parse()`'s message but keeps each issue addressable to a field. */
function zodIssuesOf(error: import("zod").ZodError): SukoonJourneyValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message }));
}

/**
 * POST /admin/journeys/validate — a pure dry run, no DB write. Returns
 * `valid:false` + structured issues instead of throwing, so the admin queue
 * can render a field-level error list rather than a generic error toast.
 */
export function validateJourneyContent(raw: unknown): {
  valid: boolean;
  issues: SukoonJourneyValidationIssue[];
  content: SukoonJourneyContent | null;
} {
  const result = sukoonJourneyContentSchema.safeParse(raw);
  if (!result.success) return { valid: false, issues: zodIssuesOf(result.error), content: null };
  return { valid: true, issues: [], content: result.data };
}

/** Every exercise_ref step's `exercise_key` must reference a real, seeded
 *  exercise — checked once per upsert so a typo shows up at save time, not as
 *  a broken deep link the first time a user reaches that step. */
async function assertExerciseKeysExist(content: SukoonJourneyContent): Promise<void> {
  const keys = new Set<string>();
  for (const day of content.days) {
    for (const step of day.steps) {
      if (step.type === "exercise_ref") keys.add(step.exercise_key);
    }
  }
  if (keys.size === 0) return;
  const { data, error } = await supabase().from("sukoon_exercises").select("key").in("key", Array.from(keys));
  if (error) throw new HttpError(500, `sukoon exercise-key check failed: ${error.message}`);
  const found = new Set(((data as { key: string }[] | null) ?? []).map((r) => r.key));
  const missing = Array.from(keys).filter((k) => !found.has(k));
  if (missing.length > 0) {
    throw badRequest(`Unknown exercise_key(s): ${missing.join(", ")} — check sukoon_exercises.key`);
  }
}

/**
 * POST /admin/journeys — upsert-by-slug: creates a new journey, or replaces an
 * existing one's title/description/premium + its FULL step set (delete +
 * reinsert — a step list has no natural per-row upsert key, matching the
 * seed migration's own convention). Bumps `version` on every save. Leaves
 * `published` untouched (a brand-new journey starts unpublished; editing a
 * published journey's content does NOT silently unpublish it — see the
 * publish/unpublish actions below for that).
 */
export async function upsertJourneyContent(content: SukoonJourneyContent): Promise<SukoonJourneyAdminSummary> {
  await assertExerciseKeysExist(content);

  const existing = await getJourneyRowBySlug(content.slug);
  const patch = {
    slug: content.slug,
    title_hi: content.title_hi,
    title_en: content.title_en,
    description_hi: content.description_hi,
    description_en: content.description_en,
    days: content.days.length,
    premium: content.premium,
    version: (existing?.version ?? 0) + 1,
    published: existing?.published ?? false,
  };

  const { data, error } = existing
    ? await supabase().from("sukoon_journeys").update(patch).eq("id", existing.id).select(JOURNEY_COLUMNS).single()
    : await supabase().from("sukoon_journeys").insert(patch).select(JOURNEY_COLUMNS).single();
  if (error) throw new HttpError(500, `sukoon admin journey upsert failed: ${error.message}`);
  const row = data as unknown as JourneyRow;

  await supabase().from("sukoon_journey_steps").delete().eq("journey_id", row.id);
  const stepRows = content.days.flatMap((day) =>
    day.steps.map((step, i) => {
      const { type, ...rest } = step;
      return { journey_id: row.id, day: day.day, step_order: i + 1, type, content_json: rest };
    }),
  );
  const { error: stepsError } = await supabase().from("sukoon_journey_steps").insert(stepRows);
  if (stepsError) throw new HttpError(500, `sukoon admin journey steps write failed: ${stepsError.message}`);

  return toAdminSummary(row, stepRows.length);
}

async function setPublished(slug: string, published: boolean): Promise<SukoonJourneyAdminSummary> {
  const existing = await getJourneyRowBySlug(slug);
  if (!existing) throw notFound("Journey not found");
  const { data, error } = await supabase()
    .from("sukoon_journeys")
    .update({ published })
    .eq("id", existing.id)
    .select(JOURNEY_COLUMNS)
    .single();
  if (error) throw new HttpError(500, `sukoon admin journey publish-state failed: ${error.message}`);
  const row = data as unknown as JourneyRow;
  return toAdminSummary(row, (await listStepsForJourney(row.id)).length);
}

/** POST /admin/journeys/:slug/publish */
export const publishJourney = (slug: string) => setPublished(slug, true);
/** POST /admin/journeys/:slug/unpublish */
export const unpublishJourney = (slug: string) => setPublished(slug, false);
