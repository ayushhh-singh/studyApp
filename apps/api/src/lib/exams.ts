/**
 * Exam registry lookups.
 *
 * `exams.is_live` is the gate on whether an exam is SELECTABLE in-product. A
 * non-live row is reference data: it has a verified paper structure but zero
 * syllabus nodes, questions, chapters and current affairs (migration 0106).
 *
 * The foreign key on `users_profile.target_exam` only proves the exam EXISTS —
 * it cannot express "and it is ready to be used". Without the check below,
 * `PATCH /profile {"target_exam":"upsc"}` succeeds and strands the user on an
 * exam with no content: an empty papers grid, no PYQs, no chapters, no
 * countdown. Verified against the live DB before this guard existed.
 */
import { DEFAULT_EXAM_CODE, examSchema, type Exam } from "@neev/shared";
import { z } from "zod";
import { supabase } from "./supabase.js";
import { HttpError, badRequest } from "./http-error.js";

export interface ExamRow {
  exam_code: string;
  is_live: boolean;
}

/** Every registered exam, ordered for display. */
export async function listExams(): Promise<ExamRow[]> {
  const { data, error } = await supabase()
    .from("exams")
    .select("exam_code, is_live")
    .order("sort_order", { ascending: true });
  if (error) throw new HttpError(500, `exam lookup failed: ${error.message}`);
  return (data ?? []) as ExamRow[];
}

/**
 * The FULL registry row for every exam — the client-facing shape.
 *
 * Deliberately a second query rather than widening `listExams`: that one is
 * called on hot paths (`liveExamCodes` runs inside the CA triage loop) and only
 * ever needs two columns, while this one drags the whole `paper_structure` and
 * `launch_scope_i18n` jsonb along. Same table, different cost profile.
 *
 * Non-live exams are INCLUDED. `launch_scope_i18n` exists precisely to state,
 * honestly, what an exam does and does not cover BEFORE a user commits to it —
 * hiding the row would leave the client unable to say "not available yet" with
 * the registry's own words. `is_live` travels with the row so the client can
 * gate selection on it (the server still enforces that in
 * `assertSelectableExam`; the flag here is for copy, never for authorisation).
 *
 * Parsed with the shared `examSchema` so a malformed jsonb becomes a loud 500
 * here rather than a silently-wrong paper structure rendered as marks and
 * qualifying thresholds in the UI.
 */
export async function listExamsDetailed(): Promise<Exam[]> {
  const { data, error } = await supabase()
    .from("exams")
    .select("exam_code, display_name_i18n, is_live, paper_structure, launch_scope_i18n, sort_order")
    .order("sort_order", { ascending: true });
  if (error) throw new HttpError(500, `exam registry lookup failed: ${error.message}`);
  const parsed = z.array(examSchema).safeParse(data ?? []);
  if (!parsed.success) {
    throw new HttpError(500, `exam registry row failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * The exam a piece of CONTENT belongs to, derived from its syllabus node.
 *
 * For a content pipeline (notes, chapters, qgen, explanations, CA deep dives)
 * this — not the user's target exam — is the right retrieval scope: the output
 * is being written for that node's exam, so it must be grounded in that exam's
 * material.
 *
 * NOT `questions.exam_code`, which is PROVENANCE ("which exam asked this") and
 * whose domain deliberately includes exams we ingest PYQs from but never sell
 * (up_ro_aro, upsssc_pet, other). A RO/ARO question mapped onto the UPPSC tree
 * must ground in UPPSC content, not in an exam nobody can select.
 *
 * A null/unknown node falls back to the default exam, matching every such row
 * in the database today; `out_of_syllabus` questions have no node at all and are
 * an acknowledged open question (docs/OUTSTANDING.md §8d M19).
 */
export async function examCodeForNode(nodeId: string | null | undefined): Promise<string> {
  if (!nodeId) return DEFAULT_EXAM_CODE;
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("exam_code")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) throw new HttpError(500, `node exam lookup failed: ${error.message}`);
  return ((data as { exam_code?: string | null } | null)?.exam_code) || DEFAULT_EXAM_CODE;
}

/** Just the LIVE exams' codes — the set any user-facing content may belong to. */
export async function liveExamCodes(): Promise<string[]> {
  return (await listExams()).filter((e) => e.is_live).map((e) => e.exam_code);
}

/**
 * The exam a user's content should be scoped to — `users_profile.target_exam`,
 * defaulting for a row written before 0106 (or a profile that vanished).
 *
 * Prefer threading an exam the CALLER already has (most of these paths already
 * read the profile for something else) over calling this: it is one extra
 * indexed read, and on hot endpoints like the dashboard that adds up. It exists
 * for the call sites that genuinely have only a user id — a route handler
 * holding `currentUserId()` and nothing else.
 *
 * NOTE this is the PRODUCT exam (what content the user sees), never the
 * provenance `questions.exam_code` ("which exam asked this question").
 */
export async function getUserExam(userId: string): Promise<string> {
  const { data, error } = await supabase()
    .from("users_profile")
    .select("target_exam")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, `target exam lookup failed: ${error.message}`);
  return ((data as { target_exam?: string } | null)?.target_exam) || DEFAULT_EXAM_CODE;
}

/**
 * Throws 400 unless `examCode` names a LIVE exam. Call before persisting any
 * user-supplied exam choice.
 */
export async function assertSelectableExam(examCode: string): Promise<void> {
  const { data, error } = await supabase()
    .from("exams")
    .select("exam_code, is_live")
    .eq("exam_code", examCode)
    .maybeSingle();
  if (error) throw new HttpError(500, `exam lookup failed: ${error.message}`);
  // Unknown code would also be caught by the FK, but as a 500 rather than a 400.
  if (!data) throw badRequest(`Unknown exam: ${examCode}`);
  if (!(data as ExamRow).is_live) {
    throw badRequest(
      `${examCode} is not available yet — its syllabus and question bank have not been published.`,
    );
  }
}
