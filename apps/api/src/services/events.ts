import type { EventBody } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";
import { touchFeature } from "../lib/feature-touch.js";

export async function recordEvent(userId: string, body: EventBody): Promise<string> {
  const { data, error } = await supabase()
    .from("events")
    .insert({ user_id: userId, name: body.name, props: body.props ?? {} })
    .select("id")
    .single();
  if (error) throw new HttpError(500, `event insert failed: ${error.message}`);
  // A real study-chapter reading signal — one central choke point rather than
  // touching every place that fires this event client-side.
  if (body.name === "note_section_read") void touchFeature(userId, "study_chapter");
  return data.id as string;
}
