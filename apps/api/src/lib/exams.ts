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
import { stateLensFor } from "./exam-config.js";
import { CURRENT_AFFAIRS_PAPER_CODE } from "./question-visibility.js";

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
  // `state_lens` is DERIVED, not selected — see its note on `examSchema`. It is
  // attached AFTER parsing because the DB has no such column, so the parse must
  // see the row exactly as stored (and the schema's `.default(null)` fills it).
  //
  // The client needs it to answer one question it otherwise cannot: whether the
  // current-affairs feed's state-lens tab exists for this exam at all. Without
  // it the tab is unconditional, and a nationally-scoped exam gets a filter on
  // `is_up_specific` that is meaningless for it by construction.
  return parsed.data.map((e) => ({ ...e, state_lens: stateLensFor(e.exam_code) }));
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

/** What a content-building CLI resolved its `--exam` flag to. */
export interface TargetExams {
  /** The exams this run will build content for. Never empty. */
  examCodes: string[];
  /** True when `--exam` was supplied, i.e. this is NOT the default live set. */
  overridden: boolean;
}

/**
 * WHICH EXAMS A CONTENT-BUILDING CLI BUILDS FOR — the one implementation, shared
 * by `qgen:topup`, `ca:run` and `ca:backfill`.
 *
 * THE EXAM-SELECTION POLICY LIVES IN THE CLI, deliberately: every runner takes
 * `examCodes` as a REQUIRED parameter precisely so this decision cannot hide
 * behind a default nobody has to think about (M24 — a defaulted `examCode` is
 * exactly what kept the qgen planner pinned to uppsc while looking
 * parameterised, and what kept `getCutoffs`' filter inert). This function is
 * where that decision is made, once.
 *
 * DEFAULT = every LIVE exam, not every registered one. A reference exam (`upsc`
 * and `mppsc` today, `is_live = false`) is one no user can select, so building
 * content for it is real spend on material nobody can reach. Measured today the
 * live set is exactly `["uppsc"]`, so every scheduled cron (none of which passes
 * `--exam`) does EXACTLY what it did before this flag existed — the second exam
 * costs nothing until it either goes live or is named explicitly.
 *
 * `--exam <code>` is that explicit naming, and it is allowed to name a NON-live
 * exam on purpose: **that is the entire point**. Stocking an exam's content
 * BEFORE launch is the real use case (`upsc` has a 202-node tree and a 2,791-row
 * PYQ bank while still being unselectable), and the alternative — flipping
 * `exams.upsc.is_live = true` to make the pipelines see it — would ALSO make it
 * selectable by real users in onboarding and Profile, exposing an exam with no
 * content. `is_live` is a SELECTION gate; using it as a LAUNCH gate is the
 * confusion `docs/OUTSTANDING.md` U7 already records. This flag is how a build
 * targets an unlaunched exam without touching that gate.
 *
 * It is only ever ONE exam. A multi-exam override would need a shared-budget
 * policy argument, and the live set already covers "several".
 *
 * Reads the registry through `listExams` rather than `liveExamCodes` because the
 * override path needs the SAME rows to validate the code and to report whether
 * it is live; one query answers both instead of two that could disagree.
 *
 * ⚑ VALIDATED AGAINST THE REGISTRY, never passed through. `getExamConfig` does
 * NOT throw on an unknown code — it logs a warn and FALLS BACK to the default
 * exam — so `--exam upcs` would silently build UPPSC's content under the wrong
 * label. That is the same silently-wrong-scope class this whole flag exists to
 * avoid, so a typo dies here, before anything is spent.
 */
export async function resolveTargetExams(opts: {
  /** The raw parsed flag. `parseArgs` yields `string | boolean | undefined`. */
  examArg: string | boolean | undefined;
  /** Script name, for error text (e.g. "ca:run"). */
  cli: string;
  /** Gerund naming what this CLI does, for the not-live notice (e.g. "ingesting"). */
  action: string;
  log?: (msg: string) => void;
}): Promise<TargetExams> {
  const log = opts.log ?? (() => {});
  const registry = await listExams();

  if (typeof opts.examArg === "string") {
    const hit = registry.find((e) => e.exam_code === opts.examArg);
    if (!hit) {
      const codes = registry
        .map((e) => e.exam_code)
        .sort()
        .join(", ");
      throw new Error(`Unknown --exam "${opts.examArg}". Registered exams: ${codes}`);
    }
    if (!hit.is_live) {
      // Not an error — but never silent. Building for an unselectable exam is a
      // deliberate pre-launch act, and the operator should see that it was.
      log(
        `--exam ${opts.examArg}: this exam is NOT live (no user can select it yet) — ${opts.action} anyway, as explicitly named.`,
      );
    }
    return { examCodes: [opts.examArg], overridden: true };
  }

  const live = registry.filter((e) => e.is_live).map((e) => e.exam_code);
  if (live.length === 0) {
    // A zero-work run and a "nothing was due" run are indistinguishable in the
    // output, so refuse rather than exit 0 having done nothing.
    throw new Error(
      `No exam has exams.is_live = true, so ${opts.cli} has nothing to work on. Pass --exam <code> to override.`,
    );
  }
  return { examCodes: live, overridden: false };
}

/**
 * Every `paper_code` belonging to one exam, for scoping a read of a table that
 * carries `paper_code` but no `exam_code` of its own — principally `questions`.
 *
 * WHY NOT `questions.exam_code`: that column is PROVENANCE ("which exam asked
 * this"), and its domain deliberately includes exams we ingest PYQs from but
 * never sell (`up_ro_aro`, `upsssc_pet`), whose papers are mapped onto the
 * DEFAULT exam's tree on purpose and ARE legitimately part of that exam's bank.
 * Filtering on it would wrongly exclude them. The paper code is the right key:
 * it is globally unique across exams (docs/multi-exam.md §0) and M23 made a
 * non-default exam's codes exam-prefixed, so it identifies the owning exam
 * unambiguously while keeping provenance-only papers where they belong.
 *
 * Returns ONLY real syllabus paper codes. `CURRENT_AFFAIRS` is deliberately NOT
 * included: it is a synthetic code with no `syllabus_nodes` row for ANY exam, so
 * adding it to every exam's set makes it match for every exam — and since every
 * CA question in the bank is generated for, and stamped with, ONE exam, that
 * leaks one exam's current affairs into another's. (Measured: it did. A UPSC
 * user still saw 20 UPPSC rows on the first page until this was corrected.)
 * Use `questionExamScopeFilter` below, which admits CA only for its own exam.
 *
 * Cached for 60s: the paper set changes only on a syllabus ingest, and this is
 * called on browse/search paths.
 */
const paperCodeCache = new Map<string, { at: number; codes: Set<string> }>();
const PAPER_CODE_TTL_MS = 60_000;

export async function paperCodesForExam(examCode: string): Promise<Set<string>> {
  const hit = paperCodeCache.get(examCode);
  if (hit && Date.now() - hit.at < PAPER_CODE_TTL_MS) return hit.codes;
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("paper_code")
    .eq("exam_code", examCode)
    .eq("depth", 0);
  if (error) throw new HttpError(500, `paper codes for ${examCode} failed: ${error.message}`);
  const codes = new Set<string>((data ?? []).map((r) => r.paper_code as string));
  paperCodeCache.set(examCode, { at: Date.now(), codes });
  return codes;
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

/**
 * A PostgREST `.or()` filter selecting exactly the `questions` rows that belong
 * to one exam. Compose it with the visibility filter — two `.or()` calls on one
 * query AND together (verified), they do not replace each other.
 *
 * Two disjuncts, because a question belongs to an exam in one of two ways:
 *   1. its `paper_code` is one of that exam's syllabus papers (globally unique
 *      across exams per docs/multi-exam.md §0, exam-prefixed by M23); or
 *   2. it is a CURRENT_AFFAIRS question GENERATED FOR that exam. CA questions
 *      have no syllabus paper of their own, so they need the second clause —
 *      and it is keyed on `exam_code` because for a CA question the generating
 *      exam IS its owner, unlike a PYQ where `exam_code` is mere provenance.
 *
 * Both interpolated values are safe: paper codes are `[A-Z0-9_]` identifiers
 * minted by ingest, and `examCode` is FK-constrained to the `exams` table.
 */
export async function questionExamScopeFilter(examCode: string): Promise<string> {
  const codes = [...(await paperCodesForExam(examCode))];
  const inList = codes.length ? `paper_code.in.(${codes.join(",")})` : "paper_code.is.null";
  return `${inList},and(paper_code.eq.${CURRENT_AFFAIRS_PAPER_CODE},exam_code.eq.${examCode})`;
}
