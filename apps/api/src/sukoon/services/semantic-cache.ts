/**
 * Sukoon semantic FAQ cache — READ path only (blueprint F2 cost spine; the
 * WRITE/admin-review path lands in a later session). Common emotional patterns
 * ("exam me fail ho gaya", "neend nahi aati") that have a human-reviewed
 * response are served straight from cache with light name personalisation,
 * skipping the model entirely.
 *
 * Matching: embed the (normalised) user message, cosine-match sukoon_semantic_cache
 * over the SAME language, and accept only a `reviewed=true` row above the
 * similarity floor. FAILS OPEN — any embed/RPC error (or the RPC not yet being
 * applied) resolves to a miss, so chat always proceeds to the model.
 */
import type { SukoonChatLanguage } from "@neev/shared";
import { embeddings } from "../../lib/embeddings.js";
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";
import { normalizeQuestion } from "../../services/mentor/normalize.js";

/** Cosine-similarity floor for a cache hit (blueprint F2: > 0.93). */
const SIMILARITY_THRESHOLD = 0.93;

interface FaqRow {
  id: string;
  response: string;
  reviewed: boolean;
  similarity: number;
}

/** Light personalisation: replace a `{{name}}` placeholder with the user's name (or drop it cleanly). */
function personalize(response: string, name: string | null): string {
  if (!response.includes("{{name}}")) return response;
  const replacement = name?.trim() ? name.trim() : "";
  return response
    .replaceAll("{{name}}", replacement)
    .replace(/\s{2,}/g, " ") // collapse the gap a dropped name may leave
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/**
 * Look up a cached response for `text` in `lang`. Returns the personalised
 * response string on a reviewed hit above the floor, else null (a miss).
 * Best-effort hit-count bump. Never throws.
 */
export async function matchSukoonFaq(
  text: string,
  lang: SukoonChatLanguage,
  name: string | null,
): Promise<string | null> {
  try {
    const query = normalizeQuestion(text);
    if (!query) return null;

    const [vec] = await embeddings().embed([query]);
    if (!vec) return null;

    const { data, error } = await supabase().rpc("match_sukoon_semantic_cache", {
      query_embedding: vec,
      filter_lang: lang,
      match_count: 1,
    });
    if (error) {
      // Includes the "function does not exist" case before 0080 is applied —
      // treated as a miss so the read path is safe to ship ahead of the migration.
      logger.warn({ err: error.message }, "sukoon semantic cache lookup unavailable; treating as miss");
      return null;
    }

    const row = (data as FaqRow[] | null)?.[0];
    if (!row || !row.reviewed || row.similarity < SIMILARITY_THRESHOLD) return null;

    // (Hit-count analytics land with the WRITE/admin path in a later session —
    // the read path stays a pure lookup.)
    return personalize(row.response, name);
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, "sukoon semantic cache error; treating as miss");
    return null;
  }
}
