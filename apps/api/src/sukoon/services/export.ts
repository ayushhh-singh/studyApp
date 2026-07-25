/**
 * Sukoon F12 — asynchronous data export (DPDP data-portability right).
 *
 * A user asks for their data; we create a job row, then build TWO artifacts
 * in-process (best-effort, not on the request path) and store them in the
 * private `sukoon-exports` bucket:
 *   1. export.json  — the COMPLETE machine-readable export: every sukoon_ row
 *      the user owns, journal bodies DECRYPTED (via the journal export RPC).
 *      This is the authoritative portability artifact.
 *   2. journal.html — a self-contained, print-ready bilingual journal document
 *      (fonts inlined). The user opens it and Save-as-PDF for a perfect-Hindi
 *      PDF. We deliberately do NOT render the PDF server-side: correct
 *      Devanagari shaping (conjuncts/matras) needs a HarfBuzz-class shaper that
 *      the available server libs (pdf-lib/pdfkit) don't provide, and shipping
 *      broken Hindi in a Hindi-first product is worse than an HTML that the
 *      browser shapes flawlessly. See the Session-13 note for the rationale.
 *
 * The download endpoint mints a FRESH short-lived signed URL each call, so a
 * link never goes stale before the whole job expires (EXPORT_TTL_HOURS). Both
 * artifacts + the job row are cleaned up by the nightly purge once expired.
 *
 * Journal/chat text is the user's own and legitimately part of THEIR export, but
 * must never reach logs — this file logs only ids/counts/statuses, never bodies.
 */
import type { SukoonExportArtifact, SukoonExportJob } from "@neev/shared";
import { supabase } from "../../lib/supabase.js";
import { HttpError } from "../../lib/http-error.js";
import { logger } from "../../lib/logger.js";
import { istToday } from "../../lib/ist.js";
import { exportRange } from "./journal.js";
import { getGardenState } from "./garden.js";
import { recordPrivacyAction } from "./privacy-audit.js";
import { buildJournalHtml } from "./export-journal-doc.js";

const EXPORTS_BUCKET = "sukoon-exports";
/** How long a ready export stays downloadable before the purge voids it. */
const EXPORT_TTL_HOURS = 48;
/** Each download link is minted fresh and lives only long enough for one fetch. */
const DOWNLOAD_URL_TTL_SECONDS = 300;
/** Journal entries reach back to "the beginning" — no real Sukoon entry predates this. */
const JOURNAL_EPOCH = "2000-01-01";

interface ExportJobRow {
  id: string;
  user_id: string;
  status: string;
  error: string | null;
  json_path: string | null;
  journal_path: string | null;
  entry_count: number | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
}

const JOB_COLUMNS =
  "id, user_id, status, error, json_path, journal_path, entry_count, requested_at, completed_at, expires_at";

function toJob(row: ExportJobRow): SukoonExportJob {
  // A ready job whose window has already closed reads as "expired" to the client
  // even before the cron flips it, so the UI never offers a dead link.
  const expired =
    row.status === "ready" && row.expires_at != null && new Date(row.expires_at).getTime() <= Date.now();
  return {
    id: row.id,
    status: expired ? "expired" : (row.status as SukoonExportJob["status"]),
    error: row.error,
    entry_count: row.entry_count,
    has_json: !expired && row.json_path != null,
    has_journal: !expired && row.journal_path != null,
    requested_at: row.requested_at,
    completed_at: row.completed_at,
    expires_at: row.expires_at,
  };
}

/** The user's most recent export job (drives the Privacy Center export card). */
export async function getLatestExportJob(userId: string): Promise<SukoonExportJob | null> {
  const { data, error } = await supabase()
    .from("sukoon_export_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `export job lookup failed: ${error.message}`);
  return data ? toJob(data as ExportJobRow) : null;
}

async function getJobRow(userId: string, jobId: string): Promise<ExportJobRow | null> {
  const { data, error } = await supabase()
    .from("sukoon_export_jobs")
    .select(JOB_COLUMNS)
    .eq("id", jobId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `export job lookup failed: ${error.message}`);
  return (data as ExportJobRow | null) ?? null;
}

/**
 * Request an export. Idempotent under the one-active-job invariant: if a job is
 * already pending/processing we return it rather than stacking work (the partial
 * unique index in 0091 makes this race-proof — a lost insert race is caught and
 * resolved to the existing row).
 */
export async function requestExport(userId: string): Promise<SukoonExportJob> {
  const existing = await getActiveJob(userId);
  if (existing) return toJob(existing);

  const { data, error } = await supabase()
    .from("sukoon_export_jobs")
    .insert({ user_id: userId, status: "pending" })
    .select(JOB_COLUMNS)
    .single();

  if (error) {
    // 23505 = the one-active-job partial unique index fired (a concurrent
    // request beat us). Return that job instead of erroring.
    if (error.code === "23505") {
      const active = await getActiveJob(userId);
      if (active) return toJob(active);
    }
    throw new HttpError(500, `export request failed: ${error.message}`);
  }

  const job = data as ExportJobRow;
  await recordPrivacyAction(userId, "export_requested");

  // Fire-and-forget: the API is a long-lived process (Render), so building the
  // bundle off the request path is safe. Failures are captured onto the job row.
  void processExportJob(userId, job.id).catch((err) => {
    logger.error({ err, jobId: job.id }, "sukoon export job crashed");
  });

  return toJob(job);
}

async function getActiveJob(userId: string): Promise<ExportJobRow | null> {
  const { data, error } = await supabase()
    .from("sukoon_export_jobs")
    .select(JOB_COLUMNS)
    .eq("user_id", userId)
    .in("status", ["pending", "processing"])
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(500, `export job lookup failed: ${error.message}`);
  return (data as ExportJobRow | null) ?? null;
}

/** GET status of one job (owner-scoped). */
export async function getExportJob(userId: string, jobId: string): Promise<SukoonExportJob> {
  const row = await getJobRow(userId, jobId);
  if (!row) throw new HttpError(404, "Export job not found");
  return toJob(row);
}

/**
 * Mint a fresh short-lived signed URL for a ready job's artifact. Ownership is
 * enforced here (the job row is owner-scoped) — this is the ONLY place an
 * export artifact path is ever signed.
 */
export async function getExportDownloadUrl(
  userId: string,
  jobId: string,
  artifact: SukoonExportArtifact,
): Promise<{ url: string; expires_at: string }> {
  const row = await getJobRow(userId, jobId);
  if (!row) throw new HttpError(404, "Export job not found");
  if (row.status !== "ready") throw new HttpError(409, "Export is not ready yet");
  if (row.expires_at != null && new Date(row.expires_at).getTime() <= Date.now()) {
    throw new HttpError(410, "This export has expired — request a new one");
  }
  const path = artifact === "json" ? row.json_path : row.journal_path;
  if (!path) throw new HttpError(404, "That export file is unavailable");

  const { data, error } = await supabase()
    .storage.from(EXPORTS_BUCKET)
    .createSignedUrl(path, DOWNLOAD_URL_TTL_SECONDS, {
      download: artifact === "json" ? "sukoon-data.json" : "sukoon-journal.html",
    });
  if (error || !data) {
    throw new HttpError(500, `could not sign export url: ${error?.message ?? "unknown"}`);
  }
  return {
    url: data.signedUrl,
    expires_at: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Job processing (off the request path)
// ---------------------------------------------------------------------------

async function processExportJob(userId: string, jobId: string): Promise<void> {
  await supabase().from("sukoon_export_jobs").update({ status: "processing" }).eq("id", jobId);

  try {
    const { bundle, entries } = await buildExportBundle(userId);
    const jsonBody = Buffer.from(JSON.stringify(bundle, null, 2), "utf8");
    const journalBody = Buffer.from(buildJournalHtml(entries), "utf8");

    const base = `${userId}/${jobId}`;
    const jsonPath = `${base}/export.json`;
    const journalPath = `${base}/journal.html`;

    const store = supabase().storage.from(EXPORTS_BUCKET);
    const up1 = await store.upload(jsonPath, jsonBody, {
      contentType: "application/json",
      upsert: true,
    });
    if (up1.error) throw new Error(`json upload failed: ${up1.error.message}`);
    const up2 = await store.upload(journalPath, journalBody, {
      // Bare "text/html" (no charset param) — Supabase Storage matches the
      // bucket's allowed_mime_types by EXACT string, so "text/html; charset=…"
      // is rejected. The doc's own <meta charset="utf-8"> carries the encoding.
      contentType: "text/html",
      upsert: true,
    });
    if (up2.error) throw new Error(`journal upload failed: ${up2.error.message}`);

    const expiresAt = new Date(Date.now() + EXPORT_TTL_HOURS * 3600_000).toISOString();
    await supabase()
      .from("sukoon_export_jobs")
      .update({
        status: "ready",
        json_path: jsonPath,
        journal_path: journalPath,
        entry_count: entries.length,
        completed_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq("id", jobId);
    await recordPrivacyAction(userId, "export_ready", { entry_count: entries.length });
    logger.info({ jobId, entries: entries.length }, "sukoon export ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : "export failed";
    await supabase()
      .from("sukoon_export_jobs")
      .update({ status: "failed", error: message.slice(0, 300), completed_at: new Date().toISOString() })
      .eq("id", jobId);
    await recordPrivacyAction(userId, "export_failed");
    logger.error({ jobId, err }, "sukoon export failed");
  }
}

/** Read every owned row (journal decrypted) into one portable object. */
async function buildExportBundle(
  userId: string,
): Promise<{ bundle: Record<string, unknown>; entries: Awaited<ReturnType<typeof exportRange>> }> {
  const db = supabase();

  // Simple owned-table reads run concurrently.
  const [
    profile,
    consents,
    conversations,
    chatSummary,
    crisisEvents,
    moods,
    checkins,
    exerciseSessions,
    journeyProgress,
    insights,
    usage,
    voiceUsage,
    subscriptions,
    notificationLog,
    privacyAudit,
    garden,
    feedback,
  ] = await Promise.all([
    one(db.from("sukoon_profiles").select("*").eq("user_id", userId).maybeSingle()),
    rows(db.from("sukoon_consents").select("consent_version, consented_at").eq("user_id", userId)),
    rows(db.from("sukoon_conversations").select("*").eq("user_id", userId)),
    one(db.from("sukoon_chat_summaries").select("summary, updated_at").eq("user_id", userId).maybeSingle()),
    rows(db.from("sukoon_crisis_events").select("level, layer, created_at").eq("user_id", userId)),
    rows(db.from("sukoon_mood_entries").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_checkins").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_exercise_sessions").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_journey_progress").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_insights").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_usage").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_voice_usage").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_subscriptions").select("*").eq("user_id", userId)),
    rows(db.from("sukoon_notification_log").select("type, day, created_at").eq("user_id", userId)),
    rows(db.from("sukoon_privacy_audit").select("action, detail, created_at").eq("user_id", userId)),
    getGardenState(userId).catch(() => null),
    rows(
      db
        .from("sukoon_feedback")
        .select("target_type, target_id, rating, body_text, created_at")
        .eq("user_id", userId),
    ),
  ]);

  // Chat messages: the user's own conversation transcripts (their data). Fetch
  // by conversation id (paged in one .in() — a single user's conversation set
  // is small; capped defensively).
  const convIds = (conversations as { id: string }[]).map((c) => c.id).slice(0, 1000);
  let messages: unknown[] = [];
  if (convIds.length > 0) {
    messages = await rows(
      db
        .from("sukoon_messages")
        .select("conversation_id, role, content, model_used, crisis_level, channel, created_at")
        .in("conversation_id", convIds)
        .order("created_at", { ascending: true }),
    );
  }

  // Journal bodies, decrypted, whole history. This is the one sensitive decrypt.
  const entries = await exportRange(userId, JOURNAL_EPOCH, istToday());

  const bundle: Record<string, unknown> = {
    export_format: "sukoon.v1",
    exported_at: new Date().toISOString(),
    user_id: userId,
    note:
      "Your complete Sukoon data export. Journal bodies are decrypted here for your portability; keep this file private.",
    profile,
    consents,
    account: profile
      ? {
          deleted_at: (profile as Record<string, unknown>).deleted_at ?? null,
          purge_after: (profile as Record<string, unknown>).purge_after ?? null,
          deletion_reason: (profile as Record<string, unknown>).deletion_reason ?? null,
        }
      : null,
    conversations,
    chat_messages: messages,
    chat_summary: chatSummary,
    crisis_events: crisisEvents,
    journal_entries: entries,
    mood_entries: moods,
    checkins,
    exercise_sessions: exerciseSessions,
    journey_progress: journeyProgress,
    insights,
    usage,
    voice_usage: voiceUsage,
    subscriptions,
    notification_log: notificationLog,
    garden,
    privacy_audit: privacyAudit,
    feedback,
  };

  return { bundle, entries };
}

// Tiny helpers to unwrap PostgREST results without repeating the error check.
async function rows<T>(builder: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
async function one<T>(builder: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  return (data ?? null) as T | null;
}
