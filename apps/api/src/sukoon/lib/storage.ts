/**
 * The private `sukoon-audio` Storage bucket (migration 0084) — pre-rendered
 * exercise/meditation/ambient audio, operator-uploaded, never user data. No
 * bucket RLS policy exists (see the migration header) — every read goes
 * through this signer, using the SERVICE ROLE client, which is deliberately
 * the ONE place premium-gating for audio is enforced (see services/exercises.ts).
 */
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";

export const SUKOON_AUDIO_BUCKET = "sukoon-audio";

/** Signed URLs are short-lived — long enough for one listen, not worth caching across days. */
const SIGNED_URL_TTL_SECONDS = 3600;

export interface SignedAudio {
  url: string;
  expires_at: string;
}

/**
 * Mints a signed URL for a path in the sukoon-audio bucket. Supabase Storage
 * does not validate the object actually exists at sign time (only at fetch),
 * so a caller must already know the path is real (has_audio_hi/en on the
 * exercise row) before calling this — see services/exercises.ts.
 */
export async function signAudioPath(path: string): Promise<SignedAudio> {
  const { data, error } = await supabase()
    .storage.from(SUKOON_AUDIO_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    throw new HttpError(500, `could not sign audio url: ${error?.message ?? "unknown error"}`);
  }
  return {
    url: data.signedUrl,
    expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
  };
}
