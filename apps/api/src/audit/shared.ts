/**
 * Shared helpers for the question-bank trust audits (consistency sweep +
 * blind re-solve). Both audits are READ-MOSTLY: they record a row per
 * (question, audit_kind) in question_audits (the evidence trail + the
 * question_quality metrics source) and only mutate the bank — unpublishing a
 * flagged question — when explicitly asked to via `--hide`. The default run is
 * therefore non-destructive: it produces the flagged list for human review
 * before any key is changed or any question is pulled.
 *
 * question_audits is upserted on (question_id, audit_kind), so a re-run
 * overwrites and the CLIs are resumable (they skip ids already audited under
 * the same --run-id).
 */
import { supabase } from "../lib/supabase.js";

export interface BilingualText {
  hi?: string | null;
  en?: string | null;
}

export interface AuditOption {
  key: string;
  text_i18n: BilingualText;
}

export interface AuditQuestion {
  id: string;
  paper_code: string;
  syllabus_node_id: string | null;
  source_kind: string | null;
  difficulty: string | null;
  year: number | null;
  stem_i18n: BilingualText;
  options_i18n: AuditOption[] | null;
  correct_option_key: string | null;
  explanation_i18n: BilingualText | null;
  meta: Record<string, unknown> | null;
}

const AUDIT_COLUMNS =
  "id, paper_code, syllabus_node_id, source_kind, difficulty, year, stem_i18n, options_i18n, " +
  "correct_option_key, explanation_i18n, meta";

/** Every published MCQ in the bank (paginated past PostgREST's 1000-row cap). */
export async function loadPublishedMcqs(): Promise<AuditQuestion[]> {
  const out: AuditQuestion[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase()
      .from("questions")
      .select(AUDIT_COLUMNS)
      .eq("is_published", true)
      .eq("type", "mcq")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`loadPublishedMcqs failed: ${error.message}`);
    const rows = (data ?? []) as unknown as AuditQuestion[];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export type AuditKind = "consistency" | "resolve";
export type AuditStatus = "ok" | "flagged" | "error" | "skipped";

export interface AuditRecord {
  question_id: string;
  audit_kind: AuditKind;
  run_id: string;
  status: AuditStatus;
  model?: string | null;
  detail: Record<string, unknown>;
}

/** Upsert one audit result (latest-per-kind). */
export async function upsertAudit(rec: AuditRecord): Promise<void> {
  const { error } = await supabase()
    .from("question_audits")
    .upsert(
      {
        question_id: rec.question_id,
        audit_kind: rec.audit_kind,
        run_id: rec.run_id,
        status: rec.status,
        model: rec.model ?? null,
        detail: rec.detail,
        created_at: nowIso(),
      },
      { onConflict: "question_id,audit_kind" },
    );
  if (error) throw new Error(`upsertAudit failed for ${rec.question_id}: ${error.message}`);
}

/** Upsert many audit results in chunks (latest-per-kind). */
export async function upsertAuditMany(recs: AuditRecord[]): Promise<void> {
  const chunk = 500;
  for (let i = 0; i < recs.length; i += chunk) {
    const rows = recs.slice(i, i + chunk).map((rec) => ({
      question_id: rec.question_id,
      audit_kind: rec.audit_kind,
      run_id: rec.run_id,
      status: rec.status,
      model: rec.model ?? null,
      detail: rec.detail,
      created_at: nowIso(),
    }));
    const { error } = await supabase().from("question_audits").upsert(rows, { onConflict: "question_id,audit_kind" });
    if (error) throw new Error(`upsertAuditMany failed: ${error.message}`);
  }
}

/** Question ids already audited under this (kind, run_id) — for resume. */
export async function alreadyAudited(kind: AuditKind, runId: string): Promise<Set<string>> {
  const done = new Set<string>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase()
      .from("question_audits")
      .select("question_id")
      .eq("audit_kind", kind)
      .eq("run_id", runId)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`alreadyAudited failed: ${error.message}`);
    const rows = (data ?? []) as { question_id: string }[];
    for (const r of rows) done.add(r.question_id);
    if (rows.length < pageSize) break;
  }
  return done;
}

/**
 * Protective hide for a flagged question: needs_review + unpublished. 0053's
 * catalog-visibility predicate requires is_published AND review_state='approved',
 * so this pulls it from every learner-facing surface pending human review, while
 * the reason is stamped into meta.audit_flag for the Review Queue.
 */
export async function hideQuestion(
  id: string,
  reason: { kind: AuditKind; run_id: string; detail: Record<string, unknown> },
): Promise<void> {
  const { data, error: readErr } = await supabase().from("questions").select("meta").eq("id", id).maybeSingle();
  if (readErr) throw new Error(`hideQuestion read failed: ${readErr.message}`);
  const meta = ((data?.meta as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const nextMeta = { ...meta, audit_flag: { ...reason, at: nowIso() } };
  const { error } = await supabase()
    .from("questions")
    .update({ review_state: "needs_review", is_published: false, meta: nextMeta })
    .eq("id", id);
  if (error) throw new Error(`hideQuestion update failed: ${error.message}`);
}

/** Whether a question's stored key is trustworthy ground truth (official answer-key-verified PYQ). */
export function groundTruth(q: AuditQuestion): "official" | "none" {
  return q.meta?.answer_key_verified ? "official" : "none";
}

/** now() — Date.now/new Date() are fine in these CLIs (not workflow scripts). */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Run tasks with bounded concurrency, preserving input order in the result. */
export async function pMap<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

/** Render an option list for a prompt (English, keyed). */
export function renderOptionsEn(options: AuditOption[]): string {
  return options.map((o) => `${o.key}) ${o.text_i18n.en ?? ""}`).join("\n");
}
