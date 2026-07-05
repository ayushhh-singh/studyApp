import type { BilingualText, SrsCard } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";

interface SrsCardRow {
  id: string;
  user_id: string;
  front_i18n: BilingualText;
  back_i18n: BilingualText;
  source_type: SrsCard["source_type"];
  source_id: string | null;
}

const SRS_CARD_COLUMNS = "id, user_id, front_i18n, back_i18n, source_type, source_id";

/**
 * Add a syllabus topic to revision. Idempotent: a second click on the same
 * node returns the existing card rather than piling up duplicates.
 */
export async function addNodeToRevision(userId: string, nodeId: string): Promise<SrsCard> {
  const { data: existing, error: existingError } = await supabase()
    .from("srs_cards")
    .select(SRS_CARD_COLUMNS)
    .eq("user_id", userId)
    .eq("source_type", "manual")
    .eq("source_id", nodeId)
    .maybeSingle();
  if (existingError) throw new HttpError(500, `srs card lookup failed: ${existingError.message}`);
  if (existing) return existing as unknown as SrsCardRow;

  const { data: node, error: nodeError } = await supabase()
    .from("syllabus_nodes")
    .select("title_i18n, description_i18n")
    .eq("id", nodeId)
    .maybeSingle();
  if (nodeError) throw new HttpError(500, `syllabus node lookup failed: ${nodeError.message}`);
  if (!node) throw notFound("Syllabus node not found");

  const { data: created, error: createError } = await supabase()
    .from("srs_cards")
    .insert({
      user_id: userId,
      front_i18n: node.title_i18n,
      back_i18n: node.description_i18n ?? { hi: "", en: "" },
      source_type: "manual",
      source_id: nodeId,
    })
    .select(SRS_CARD_COLUMNS)
    .single();
  if (createError) throw new HttpError(500, `srs card insert failed: ${createError.message}`);
  return created as unknown as SrsCardRow;
}
