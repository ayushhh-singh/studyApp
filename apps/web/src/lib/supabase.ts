import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — anon key only, used solely for direct-to-Storage
 * uploads of handwritten answer photos (bucket `answer-images`). Everything
 * else (all Postgres reads/writes) goes through the Express API; storage is
 * the one exception, so multi-megabyte image bytes aren't proxied through it.
 * The bucket's dev-permissive RLS policy (migration 0030) is what makes the
 * anon key sufficient pre-auth — see CLAUDE.md, replaced in the auth phase.
 */
let client: SupabaseClient | null = null;

export const ANSWER_IMAGES_BUCKET = "answer-images";

export function supabaseBrowser(): SupabaseClient {
  if (!client) {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    if (!url || !anonKey) {
      throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY (apps/web/.env.local)");
    }
    client = createClient(url, anonKey, { auth: { persistSession: false } });
  }
  return client;
}
