/**
 * Sukoon F7 — shared row-level plumbing for Guided Journeys, used by BOTH the
 * user-facing runtime (services/journeys.ts) and the admin content queue
 * (services/journeys-admin.ts) so the column list / row shape / step-content
 * parsing lives in exactly one place.
 */
import { sukoonJourneyStepContentSchema, type SukoonJourneyStep, type SukoonJourneyStepContent } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";

export const JOURNEY_COLUMNS =
  "id, slug, title_hi, title_en, description_hi, description_en, days, premium, version, published";
export const STEP_COLUMNS = "id, day, step_order, type, content_json";

export interface JourneyRow {
  id: string;
  slug: string;
  title_hi: string;
  title_en: string;
  description_hi: string;
  description_en: string;
  days: number;
  premium: boolean;
  version: number;
  published: boolean;
}

export interface StepRow {
  id: string;
  day: number;
  step_order: number;
  type: string;
  content_json: unknown;
}

export async function getJourneyRowBySlug(slug: string): Promise<JourneyRow | null> {
  const { data, error } = await supabase()
    .from("sukoon_journeys")
    .select(JOURNEY_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new HttpError(500, `sukoon journey lookup failed: ${error.message}`);
  return data as unknown as JourneyRow | null;
}

export async function listStepsForJourney(journeyId: string): Promise<StepRow[]> {
  const { data, error } = await supabase()
    .from("sukoon_journey_steps")
    .select(STEP_COLUMNS)
    .eq("journey_id", journeyId)
    .order("day", { ascending: true })
    .order("step_order", { ascending: true });
  if (error) throw new HttpError(500, `sukoon journey steps lookup failed: ${error.message}`);
  return (data as unknown as StepRow[]) ?? [];
}

/** Narrows one step row's content_json against the discriminated union —
 *  throws loudly on malformed persisted content (a real bug worth surfacing,
 *  same posture as services/exercises.ts's parseConfig). */
export function toStepContent(row: StepRow): SukoonJourneyStepContent {
  const contentInput = { type: row.type, ...(row.content_json as Record<string, unknown>) };
  return sukoonJourneyStepContentSchema.parse(contentInput);
}

/** Same as toStepContent, plus where the step lives (id/day/step_order) — the
 *  shape the user-facing runtime returns to the client. */
export function toStep(row: StepRow): SukoonJourneyStep {
  return { ...toStepContent(row), id: row.id, day: row.day, step_order: row.step_order };
}
