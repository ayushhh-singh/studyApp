/**
 * Service-role Supabase client for server-side / ingestion use.
 *
 * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from apps/api/.env (loaded via
 * node's --env-file in the npm scripts). The service role bypasses RLS, which
 * is what ingestion needs. NEVER import this into the web app.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (apps/api/.env)",
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
