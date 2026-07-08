import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client (anon key). Two jobs:
 *   1. Authentication — Google OAuth (PKCE) + email OTP. Session is persisted
 *      and auto-refreshed by supabase-js; the OAuth redirect is exchanged
 *      automatically via detectSessionInUrl.
 *   2. Direct-to-Storage uploads of handwritten answer photos (bucket
 *      `answer-images`) — the one place the browser talks to Supabase directly
 *      instead of through the Express API (avoids proxying multi-MB image bytes).
 *
 * A single shared instance so the persisted session backs both.
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
    client = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return client;
}
