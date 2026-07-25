/**
 * Append-only privacy-action audit (F12). Best-effort: an audit write must never
 * fail the user's actual privacy action (a lost audit row is a logging gap, not
 * a correctness bug), so this swallows errors into the logger. detail is small,
 * non-sensitive metadata only — never journal/chat text.
 */
import { supabase } from "../../lib/supabase.js";
import { logger } from "../../lib/logger.js";

export type SukoonPrivacyActionName =
  | "export_requested"
  | "export_ready"
  | "export_failed"
  | "delete_requested"
  | "delete_cancelled"
  | "consent_withdrawn"
  | "account_purged";

export async function recordPrivacyAction(
  userId: string,
  action: SukoonPrivacyActionName,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const { error } = await supabase()
    .from("sukoon_privacy_audit")
    .insert({ user_id: userId, action, detail });
  if (error) logger.warn({ error, action }, "sukoon privacy audit write failed");
}
