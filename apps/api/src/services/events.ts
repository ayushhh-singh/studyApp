import type { EventBody } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

export async function recordEvent(userId: string, body: EventBody): Promise<string> {
  const { data, error } = await supabase()
    .from("events")
    .insert({ user_id: userId, name: body.name, props: body.props ?? {} })
    .select("id")
    .single();
  if (error) throw new HttpError(500, `event insert failed: ${error.message}`);
  return data.id as string;
}
