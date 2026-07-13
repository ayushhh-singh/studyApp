/**
 * Admin moderation over Community reports — the Review Queue's "Reports" tab
 * (apps/web/src/components/review/reports-review-panel.tsx). Structurally
 * unlike the questions/notes queues (reports are user complaints about
 * user-generated content, not AI-generated drafts awaiting a publish gate),
 * so it gets its own list/counts/action functions here, mirroring the shape
 * of services/review.ts and services/notes.ts's review-queue halves.
 */
import type { CommunityAuthor, ReportAction, ReportQueueItem, ReportedContentPreview, ReportTargetType } from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";

export const REPORTS_PAGE_SIZE = 10;

interface OpenReportRow {
  id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  detail: string | null;
  status: string;
  created_at: string;
}

interface ReportGroup {
  target_type: ReportTargetType;
  target_id: string;
  latest_report_id: string;
  reason: string;
  detail: string | null;
  reporter_count: number;
  created_at: string;
}

/** Every open report, grouped by (target_type, target_id) — most-recently-reported first. */
async function fetchOpenGroups(): Promise<ReportGroup[]> {
  const { data, error } = await supabase()
    .from("reports")
    .select("id, target_type, target_id, reason, detail, status, created_at")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(500, `reports lookup failed: ${error.message}`);

  const rows = (data ?? []) as OpenReportRow[];
  const byTarget = new Map<string, ReportGroup>();
  for (const row of rows) {
    const key = `${row.target_type}:${row.target_id}`;
    const existing = byTarget.get(key);
    if (existing) {
      existing.reporter_count += 1;
    } else {
      byTarget.set(key, {
        target_type: row.target_type,
        target_id: row.target_id,
        latest_report_id: row.id,
        reason: row.reason,
        detail: row.detail,
        reporter_count: 1,
        created_at: row.created_at,
      });
    }
  }
  return [...byTarget.values()];
}

async function fetchContentPreview(
  targetType: ReportTargetType,
  targetId: string,
): Promise<ReportedContentPreview | null> {
  if (targetType === "post") {
    const { data, error } = await supabase()
      .from("discussion_posts")
      .select("user_id, body, moderation_status")
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw new HttpError(500, `post lookup failed: ${error.message}`);
    if (!data) return null;
    const row = data as { user_id: string; body: string; moderation_status: string };
    const author = await fetchAuthor(row.user_id);
    return {
      target_type: "post",
      target_id: targetId,
      preview_text: row.body.length > 400 ? `${row.body.slice(0, 400)}…` : row.body,
      author,
      moderation_status: row.moderation_status as ReportedContentPreview["moderation_status"],
    };
  }
  const { data, error } = await supabase()
    .from("discussion_threads")
    .select("user_id, title, moderation_status")
    .eq("id", targetId)
    .maybeSingle();
  if (error) throw new HttpError(500, `thread lookup failed: ${error.message}`);
  if (!data) return null;
  const row = data as { user_id: string; title: string; moderation_status: string };
  const author = await fetchAuthor(row.user_id);
  return {
    target_type: "thread",
    target_id: targetId,
    preview_text: row.title,
    author,
    moderation_status: row.moderation_status as ReportedContentPreview["moderation_status"],
  };
}

async function fetchAuthor(userId: string): Promise<CommunityAuthor> {
  const { data, error } = await supabase().from("users_profile").select("id, handle, display_name").eq("id", userId).maybeSingle();
  if (error) throw new HttpError(500, `author lookup failed: ${error.message}`);
  return (data as CommunityAuthor | null) ?? { id: userId, handle: null, display_name: null };
}

export async function listReportsQueue(page: number): Promise<{ items: ReportQueueItem[]; total: number }> {
  const groups = await fetchOpenGroups();
  const from = (page - 1) * REPORTS_PAGE_SIZE;
  const pageGroups = groups.slice(from, from + REPORTS_PAGE_SIZE);

  const items = await Promise.all(
    pageGroups.map(async (g) => ({
      id: `${g.target_type}:${g.target_id}`,
      target_type: g.target_type,
      target_id: g.target_id,
      reason: g.reason as ReportQueueItem["reason"],
      detail: g.detail,
      status: "open" as const,
      reporter_count: g.reporter_count,
      content: await fetchContentPreview(g.target_type, g.target_id),
      created_at: g.created_at,
    })),
  );
  return { items, total: groups.length };
}

export async function reportsCounts(): Promise<{ open: number }> {
  const groups = await fetchOpenGroups();
  return { open: groups.length };
}

/** Resolve every open report on a target with one admin action. */
export async function resolveReportsForTarget(
  adminId: string,
  targetType: ReportTargetType,
  targetId: string,
  action: ReportAction,
): Promise<{ id: string; status: "actioned" | "dismissed" }> {
  const { data: openReports, error: openError } = await supabase()
    .from("reports")
    .select("id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("status", "open");
  if (openError) throw new HttpError(500, `reports lookup failed: ${openError.message}`);
  if (!openReports || openReports.length === 0) throw notFound("No open reports for this content");

  const resultStatus: "actioned" | "dismissed" = action === "dismiss" ? "dismissed" : "actioned";

  if (action === "remove_content") {
    const table = targetType === "post" ? "discussion_posts" : "discussion_threads";
    const { error } = await supabase().from(table).update({ moderation_status: "removed" }).eq("id", targetId);
    if (error) throw new HttpError(500, `content removal failed: ${error.message}`);
  } else if (action === "lock_thread") {
    let threadId = targetId;
    if (targetType === "post") {
      const { data: post, error } = await supabase().from("discussion_posts").select("thread_id").eq("id", targetId).maybeSingle();
      if (error) throw new HttpError(500, `post lookup failed: ${error.message}`);
      if (!post) throw notFound("Post not found");
      threadId = (post as { thread_id: string }).thread_id;
    }
    const { error } = await supabase().from("discussion_threads").update({ is_locked: true }).eq("id", threadId);
    if (error) throw new HttpError(500, `thread lock failed: ${error.message}`);
  }

  const { error: resolveError } = await supabase()
    .from("reports")
    .update({ status: resultStatus, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .in(
      "id",
      (openReports as { id: string }[]).map((r) => r.id),
    );
  if (resolveError) throw new HttpError(500, `report resolution failed: ${resolveError.message}`);

  return { id: `${targetType}:${targetId}`, status: resultStatus };
}
