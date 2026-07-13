import type { PushPreferences, PushStatus, PushSubscribeBody } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { badRequest, HttpError } from "../lib/http-error.js";

const DEFAULT_PREFERENCES: PushPreferences = {
  quiz_ready: true,
  streak_at_risk: true,
  srs_due: true,
};

const IPV4_LITERAL = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * The sender job later feeds this endpoint straight into web-push, which
 * makes a real outbound HTTP POST to it — an unvalidated `endpoint` from the
 * client is an SSRF primitive (a malicious authenticated user could register
 * an internal/metadata URL as their "push subscription" and let the hourly
 * sender job probe it). Real push-service endpoints are always https:// on a
 * public vendor domain, never a bare IP literal, so rejecting IP-literal
 * hosts (which covers loopback/private/link-local/cloud-metadata addresses
 * without needing a vendor-domain allowlist that could go stale) plus
 * enforcing https closes the practical attack surface.
 */
function assertSafePushEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw badRequest("Invalid push endpoint");
  }
  if (url.protocol !== "https:") throw badRequest("Push endpoint must be https");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw badRequest("Invalid push endpoint host");
  if (IPV4_LITERAL.test(host) || host.includes(":")) throw badRequest("Invalid push endpoint host");
}

export async function subscribe(userId: string, body: PushSubscribeBody): Promise<void> {
  assertSafePushEndpoint(body.endpoint);
  const { error } = await supabase()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: userId,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth_key: body.keys.auth,
        user_agent: body.user_agent ?? null,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
  if (error) throw new HttpError(500, `push subscribe failed: ${error.message}`);

  // Ensure a preferences row exists so later reads never see "unset" — a
  // fresh subscribe always opts into all types (the pre-prompt already made
  // the case for push before this call happens).
  const { error: prefErr } = await supabase()
    .from("push_preferences")
    .upsert({ user_id: userId, ...DEFAULT_PREFERENCES }, { onConflict: "user_id", ignoreDuplicates: true });
  if (prefErr) throw new HttpError(500, `push preferences init failed: ${prefErr.message}`);
}

export async function unsubscribe(userId: string, endpoint: string): Promise<void> {
  const { error } = await supabase()
    .from("push_subscriptions")
    .delete()
    .eq("user_id", userId)
    .eq("endpoint", endpoint);
  if (error) throw new HttpError(500, `push unsubscribe failed: ${error.message}`);
}

export async function getStatus(userId: string): Promise<PushStatus> {
  const [subsRes, prefRes] = await Promise.all([
    supabase().from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase()
      .from("push_preferences")
      .select("quiz_ready, streak_at_risk, srs_due")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (subsRes.error) throw new HttpError(500, `push status failed: ${subsRes.error.message}`);
  if (prefRes.error) throw new HttpError(500, `push preferences read failed: ${prefRes.error.message}`);
  return {
    subscribed: (subsRes.count ?? 0) > 0,
    preferences: (prefRes.data as PushPreferences | null) ?? DEFAULT_PREFERENCES,
  };
}

export async function updatePreferences(
  userId: string,
  patch: Partial<PushPreferences>,
): Promise<PushPreferences> {
  const { data, error } = await supabase()
    .from("push_preferences")
    .upsert({ user_id: userId, ...DEFAULT_PREFERENCES, ...patch }, { onConflict: "user_id" })
    .select("quiz_ready, streak_at_risk, srs_due")
    .single();
  if (error) throw new HttpError(500, `push preferences update failed: ${error.message}`);
  return data as PushPreferences;
}
