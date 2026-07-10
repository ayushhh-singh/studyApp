/**
 * "Report this question" — user complaints about a specific question, and the
 * admin Reports queue that triages them (the Review Queue's "Reported questions"
 * tab). Highest-signal QA now that real users hit the bank.
 *
 * The load-bearing behaviour: TWO INDEPENDENT open reports on one question →
 * auto needs_review + unpublished (done here, not in a DB trigger, so it is
 * observable/testable). "Independent" = distinct reporters, which the partial
 * unique index question_reports_one_open_per_user makes equal to the open-report
 * count (one open report per user per question).
 */
import type {
  BilingualText,
  CreateQuestionReportBody,
  GenerationMeta,
  QuestionReportAction,
  QuestionReportActionResult,
  QuestionReportEntry,
  QuestionReportProvenance,
  QuestionReportQueueItem,
  QuestionReportReason,
  QuestionReportResult,
  ReviewQuestion,
} from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError, notFound } from "../lib/http-error.js";
import { generateGroundedExplanation } from "./question-explanation.js";

export const QUESTION_REPORTS_PAGE_SIZE = 10;

const AUTO_HIDE_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// User-facing submit
// ---------------------------------------------------------------------------
export async function createQuestionReport(
  userId: string,
  questionId: string,
  body: CreateQuestionReportBody,
): Promise<QuestionReportResult> {
  // Question must exist (any state — a user can report an already-hidden one).
  const { data: q, error: qErr } = await supabase()
    .from("questions")
    .select("id, is_published, meta")
    .eq("id", questionId)
    .maybeSingle();
  if (qErr) throw new HttpError(500, `question lookup failed: ${qErr.message}`);
  if (!q) throw notFound("Question not found");

  // One open report per (question, user): update the existing open one, else insert.
  const { data: existing } = await supabase()
    .from("question_reports")
    .select("id")
    .eq("question_id", questionId)
    .eq("user_id", userId)
    .eq("status", "open")
    .maybeSingle();

  let reportId: string;
  if (existing) {
    const { data, error } = await supabase()
      .from("question_reports")
      .update({ reason: body.reason, detail: body.detail ?? null })
      .eq("id", (existing as { id: string }).id)
      .select("id")
      .single();
    if (error) throw new HttpError(500, `report update failed: ${error.message}`);
    reportId = (data as { id: string }).id;
  } else {
    const { data, error } = await supabase()
      .from("question_reports")
      .insert({ question_id: questionId, user_id: userId, reason: body.reason, detail: body.detail ?? null })
      .select("id")
      .single();
    // 23505 = the partial-unique race (a concurrent first report from the same
    // user); treat as already-reported and move on.
    if (error && error.code !== "23505") throw new HttpError(500, `report insert failed: ${error.message}`);
    reportId = data ? (data as { id: string }).id : "";
  }

  // Count distinct reporters (= open reports) and auto-hide at the threshold.
  const { count } = await supabase()
    .from("question_reports")
    .select("id", { count: "exact", head: true })
    .eq("question_id", questionId)
    .eq("status", "open");
  const openReports = count ?? 0;

  let autoHidden = false;
  const isPublished = (q as { is_published: boolean }).is_published;
  if (openReports >= AUTO_HIDE_THRESHOLD && isPublished) {
    const meta = (((q as { meta: Record<string, unknown> | null }).meta ?? {}) as Record<string, unknown>);
    const nextMeta = { ...meta, audit_flag: { kind: "user_reports", count: openReports, at: new Date().toISOString() } };
    const { error } = await supabase()
      .from("questions")
      .update({ review_state: "needs_review", is_published: false, meta: nextMeta })
      .eq("id", questionId);
    if (error) throw new HttpError(500, `auto-hide failed: ${error.message}`);
    autoHidden = true;
  }

  return { id: reportId || questionId, status: "open", auto_hidden: autoHidden };
}

// ---------------------------------------------------------------------------
// Admin queue
// ---------------------------------------------------------------------------
interface OpenReportRow {
  id: string;
  question_id: string;
  reason: QuestionReportReason;
  detail: string | null;
  created_at: string;
}

async function fetchOpenReports(): Promise<Map<string, OpenReportRow[]>> {
  const byQuestion = new Map<string, OpenReportRow[]>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase()
      .from("question_reports")
      .select("id, question_id, reason, detail, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new HttpError(500, `reports lookup failed: ${error.message}`);
    const rows = (data ?? []) as OpenReportRow[];
    for (const r of rows) {
      const list = byQuestion.get(r.question_id) ?? [];
      list.push(r);
      byQuestion.set(r.question_id, list);
    }
    if (rows.length < pageSize) break;
  }
  return byQuestion;
}

export async function questionReportsCounts(): Promise<{ open: number }> {
  const byQuestion = await fetchOpenReports();
  return { open: byQuestion.size };
}

const QUESTION_COLUMNS =
  "id, type, stage, paper_code, syllabus_node_id, year, source, source_kind, exam_code, stem_i18n, options_i18n, " +
  "correct_option_key, explanation_i18n, difficulty, word_limit, marks, review_state, is_published, publish_gate_ok, " +
  "generation_meta, meta, created_at, syllabus_nodes(title_i18n)";

interface QuestionRow {
  id: string;
  type: ReviewQuestion["type"];
  stage: ReviewQuestion["stage"];
  paper_code: string;
  syllabus_node_id: string | null;
  year: number | null;
  source: ReviewQuestion["source"];
  source_kind: string | null;
  exam_code: string | null;
  stem_i18n: BilingualText;
  options_i18n: ReviewQuestion["options_i18n"];
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
  difficulty: ReviewQuestion["difficulty"];
  word_limit: number | null;
  marks: number | null;
  review_state: ReviewQuestion["review_state"];
  is_published: boolean;
  publish_gate_ok: boolean;
  generation_meta: GenerationMeta | null;
  meta: Record<string, unknown> | null;
  created_at: string;
  syllabus_nodes: { title_i18n: BilingualText } | null;
}

function toReviewQuestion(row: QuestionRow): ReviewQuestion {
  return {
    id: row.id,
    type: row.type,
    stage: row.stage,
    paper_code: row.paper_code,
    syllabus_node_id: row.syllabus_node_id,
    syllabus_title_i18n: row.syllabus_nodes?.title_i18n ?? null,
    year: row.year,
    source: row.source,
    stem_i18n: row.stem_i18n,
    options_i18n: row.options_i18n,
    correct_option_key: row.correct_option_key,
    explanation_i18n: row.explanation_i18n,
    difficulty: row.difficulty,
    word_limit: row.word_limit,
    marks: row.marks === null ? null : Number(row.marks),
    review_state: row.review_state,
    is_published: row.is_published,
    publish_gate_ok: row.publish_gate_ok,
    generation_meta: row.generation_meta,
    created_at: row.created_at,
    similar: [],
  };
}

function toProvenance(row: QuestionRow): QuestionReportProvenance {
  return {
    source_kind: row.source_kind,
    exam_code: row.exam_code,
    year: row.year,
    prompt_version: row.generation_meta?.prompt_version ?? null,
    is_published: row.is_published,
    review_state: row.review_state,
    answer_key_verified: !!row.meta?.answer_key_verified,
    generation_meta: row.generation_meta,
  };
}

export async function listQuestionReportsQueue(page: number): Promise<{ items: QuestionReportQueueItem[]; total: number }> {
  const byQuestion = await fetchOpenReports();
  // Most-recently-reported question first.
  const groups = [...byQuestion.entries()]
    .map(([questionId, reports]) => ({ questionId, reports }))
    .sort((a, b) => b.reports[0].created_at.localeCompare(a.reports[0].created_at));

  const from = (page - 1) * QUESTION_REPORTS_PAGE_SIZE;
  const pageGroups = groups.slice(from, from + QUESTION_REPORTS_PAGE_SIZE);
  if (pageGroups.length === 0) return { items: [], total: groups.length };

  const { data, error } = await supabase()
    .from("questions")
    .select(QUESTION_COLUMNS)
    .in(
      "id",
      pageGroups.map((g) => g.questionId),
    );
  if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
  const rowsById = new Map((data as unknown as QuestionRow[]).map((r) => [r.id, r]));

  const items: QuestionReportQueueItem[] = [];
  for (const g of pageGroups) {
    const row = rowsById.get(g.questionId);
    if (!row) continue; // question deleted since the report — skip
    const entries: QuestionReportEntry[] = g.reports.map((r) => ({ reason: r.reason, detail: r.detail, created_at: r.created_at }));
    items.push({
      question_id: g.questionId,
      report_count: g.reports.length,
      reasons: [...new Set(g.reports.map((r) => r.reason))],
      reports: entries,
      latest_created_at: g.reports[0].created_at,
      question: toReviewQuestion(row),
      provenance: toProvenance(row),
    });
  }
  return { items, total: groups.length };
}

// ---------------------------------------------------------------------------
// Admin resolution
// ---------------------------------------------------------------------------
async function resolveOpenReports(
  questionId: string,
  adminId: string,
  status: "resolved" | "dismissed",
  resolution: string,
): Promise<number> {
  const { data, error } = await supabase()
    .from("question_reports")
    .update({ status, resolution, resolved_by: adminId, resolved_at: new Date().toISOString() })
    .eq("question_id", questionId)
    .eq("status", "open")
    .select("id");
  if (error) throw new HttpError(500, `report resolution failed: ${error.message}`);
  return (data ?? []).length;
}

interface QuestionState {
  is_published: boolean;
  review_state: ReviewQuestion["review_state"];
  meta: Record<string, unknown> | null;
  publish_gate_ok: boolean;
  correct_option_key: string | null;
  options_i18n: { key: string }[] | null;
}

async function readQuestionState(questionId: string): Promise<QuestionState> {
  const { data, error } = await supabase()
    .from("questions")
    .select("is_published, review_state, meta, publish_gate_ok, correct_option_key, options_i18n")
    .eq("id", questionId)
    .maybeSingle();
  if (error) throw new HttpError(500, `question lookup failed: ${error.message}`);
  if (!data) throw notFound("Question not found");
  return data as unknown as QuestionState;
}

/**
 * Republish an audited-and-fixed question: approved, clearing the audit_flag,
 * and published ONLY if the bilingual publish gate passes (mirrors
 * approveQuestion — setting is_published=true on a gate-failing row would trip
 * the publish trigger and 500). A gate-failing row becomes approved-but-hidden.
 */
async function republish(questionId: string, patch: Record<string, unknown> = {}): Promise<void> {
  const cur = await readQuestionState(questionId);
  const meta = { ...((cur.meta ?? {}) as Record<string, unknown>) };
  delete meta.audit_flag;
  const { error } = await supabase()
    .from("questions")
    .update({ review_state: "approved", is_published: cur.publish_gate_ok, meta, ...patch })
    .eq("id", questionId);
  if (error) throw new HttpError(500, `republish failed: ${error.message}`);
}

export async function resolveQuestionReport(
  adminId: string,
  questionId: string,
  action: QuestionReportAction,
  correctKey?: string,
): Promise<QuestionReportActionResult> {
  await readQuestionState(questionId); // 404 if gone

  let resolvedStatus: "resolved" | "dismissed" = "resolved";

  switch (action) {
    case "fix_key": {
      if (!correctKey) throw new HttpError(400, "correct_option_key required for fix_key");
      const cur = await readQuestionState(questionId);
      // The key must be one of the question's actual options, or the publish
      // trigger would reject the republish (0017's MCQ gate requires the key to
      // match an option).
      const optionKeys = (cur.options_i18n ?? []).map((o) => o.key);
      if (!optionKeys.includes(correctKey)) {
        throw new HttpError(400, `correct_option_key ${correctKey} is not one of this question's options (${optionKeys.join(", ")})`);
      }
      // Fix the key AND clear the (now-stale) explanation so the next view
      // regenerates a grounded one consistent with the corrected key. Record the
      // old→new key for audit; publish only if the gate passes.
      const meta = { ...((cur.meta ?? {}) as Record<string, unknown>) };
      delete meta.audit_flag;
      meta.key_corrected = { from: cur.correct_option_key, to: correctKey, by: adminId, at: new Date().toISOString() };
      const { error } = await supabase()
        .from("questions")
        .update({ correct_option_key: correctKey, explanation_i18n: null, review_state: "approved", is_published: cur.publish_gate_ok, meta })
        .eq("id", questionId);
      if (error) throw new HttpError(500, `fix_key failed: ${error.message}`);
      break;
    }
    case "regenerate_explanation": {
      // Regenerate a grounded explanation that argues for the current key, then
      // republish. Use this for "wrong explanation" reports (the key is fine);
      // for a wrong KEY, use fix_key instead.
      await generateGroundedExplanation(questionId, { force: true, userId: adminId });
      await republish(questionId);
      break;
    }
    case "unpublish": {
      const cur = await readQuestionState(questionId);
      const meta = { ...((cur.meta ?? {}) as Record<string, unknown>), audit_flag: { kind: "admin_unpublish", by: adminId, at: new Date().toISOString() } };
      const { error } = await supabase()
        .from("questions")
        .update({ review_state: "needs_review", is_published: false, meta })
        .eq("id", questionId);
      if (error) throw new HttpError(500, `unpublish failed: ${error.message}`);
      break;
    }
    case "dismiss": {
      resolvedStatus = "dismissed";
      // If it was auto-hidden purely by user reports, dismissing the reports
      // restores it; otherwise leave the question's state untouched.
      const cur = await readQuestionState(questionId);
      const flag = (cur.meta as { audit_flag?: { kind?: string } } | null)?.audit_flag;
      if (!cur.is_published && flag?.kind === "user_reports") await republish(questionId);
      break;
    }
  }

  const resolutionMap: Record<QuestionReportAction, string> = {
    fix_key: "fixed_key",
    regenerate_explanation: "regenerated_explanation",
    unpublish: "unpublished",
    dismiss: "dismissed",
  };
  const resolvedReports = await resolveOpenReports(questionId, adminId, resolvedStatus, resolutionMap[action]);
  const final = await readQuestionState(questionId);
  return { question_id: questionId, action, is_published: final.is_published, review_state: final.review_state, resolved_reports: resolvedReports };
}
