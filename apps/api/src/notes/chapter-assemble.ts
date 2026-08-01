/**
 * `notes:chapter:assemble` — deterministic bridge from a chapter authored OUTSIDE
 * the app's Anthropic API into the same persist + embed path the real generator
 * uses. Mirrors ingest:assemble (subagent extraction JSON → ingest:pyq:load).
 *
 * When the app's ANTHROPIC_API_KEY has no credit, chapters are authored by
 * running the SAME multi-pass (outline → web research → section → coherence →
 * fact audit → Hindi translation) via the coding agent's own model + web tools,
 * emitted as one JSON file per node matching chapterAssembleInputSchema, and
 * loaded here. Every downstream step (publish gate, per-section embedding, reader,
 * review queue, mentor retrieval) is byte-identical to a real-API chapter — only
 * the author of the text differs (recorded honestly as model 'claude-code-agent').
 *
 *   pnpm notes:chapter:assemble --file <path.json>
 *   pnpm notes:chapter:assemble --dir <dir-of-json>
 *
 * GATE: a chapter referencing a `pyq_id` that belongs to ANOTHER exam is
 * REFUSED outright (nothing written, non-zero exit) — see the disposition note
 * on `assembleChapter`. Ids that exist nowhere are still warn-and-dropped, but
 * the drop is now reported in the summary instead of hiding inside `N/M`.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parseArgs } from "../ingest/_shared.js";
import {
  auditedFactSchema,
  chapterSectionSchema,
  noteSourceSchema,
  bilingualTextSchema,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
import { examCodeForNode, questionExamScopeFilter } from "../lib/exams.js";
import { persistChapter } from "./chapter-persist.js";
import { CHAPTER_PROMPT_VERSION } from "./chapter-prompts.js";

export const chapterAssembleInputSchema = z.object({
  node_id: z.string().uuid(),
  overview_i18n: bilingualTextSchema,
  quick_revision_i18n: z.object({ hi: z.array(z.string()), en: z.array(z.string()) }).optional(),
  sections: z.array(chapterSectionSchema).min(1),
  fact_audit_facts: z.array(auditedFactSchema),
  sources: z.array(noteSourceSchema).default([]),
  section_plan: z
    .array(z.object({ id: z.string(), heading_en: z.string(), focus: z.string() }))
    .default([]),
  web_search_used: z.boolean().default(false),
  machine_translated: z.boolean().default(true),
});
export type ChapterAssembleInput = z.infer<typeof chapterAssembleInputSchema>;

/** `.in()` builds a URL-encoded list — chunk it so a long id list can't blow the URL length limit. */
const ID_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A referenced `pyq_id` that EXISTS in the bank but is not in this chapter's
 * exam scope. `ownerExam` is the exam that actually owns the question's paper
 * (resolved from `syllabus_nodes`' depth-0 roots), or null when the paper code
 * is in NO exam's list — a synthetic/administrative code such as `EDGE`.
 *
 * That null case exists because the previous message asserted "belongs to a
 * DIFFERENT exam" for every out-of-scope id, which is FALSE for a synthetic
 * paper code (docs/OUTSTANDING.md M44 records one real row: `0988b99e…`,
 * `paper_code='EDGE'`, `exam_code='uppsc'`, no node) and would send a reader
 * hunting a cross-exam bug that does not exist.
 */
export interface ForeignPyqRef {
  id: string;
  paperCode: string | null;
  ownerExam: string | null;
}

/** Thrown by `assembleChapter` when a chapter references another exam's questions. */
export class ForeignPyqIdsError extends Error {
  constructor(
    readonly nodeId: string,
    readonly examCode: string,
    readonly refs: ForeignPyqRef[],
  ) {
    super(
      `${refs.length} referenced pyq_id(s) are NOT in this node's exam (${examCode}) — refusing the chapter.\n` +
        refs
          .map(
            (r) =>
              `      ${r.id}  paper_code=${r.paperCode ?? "?"}  ` +
              (r.ownerExam
                ? `owned by exam "${r.ownerExam}"`
                : `in NO exam's paper list (synthetic/administrative paper code — not a chapter-referenceable question)`),
          )
          .join("\n") +
        `\n    A chip that RESOLVES but points outside this exam means the chapter was drafted from ` +
        `another exam's chapter and its PYQ chips were carried over without being re-grounded ` +
        `(docs/multi-exam.md §5b). Re-take the ids from this node's OWN ` +
        `\`notes:chapter:context\` pack and re-run — do not simply delete them, or the chapter ` +
        `ships with no PYQ chips at all.`,
    );
    this.name = "ForeignPyqIdsError";
  }
}

/** paper_code -> owning exam_code, from the depth-0 syllabus roots (≤ ~30 rows). */
async function paperCodeOwners(): Promise<Map<string, string>> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("paper_code, exam_code")
    .eq("depth", 0);
  if (error) throw new Error(`paper-code owner lookup failed: ${error.message}`);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as { paper_code: string; exam_code: string }[]) out.set(r.paper_code, r.exam_code);
  return out;
}

/**
 * Validate every real pyq_id referenced (a) exists in the bank and (b) belongs to
 * the SAME exam as the chapter's node.
 *
 * (b) closes docs/OUTSTANDING.md §8c M21. Checking existence alone was harmless
 * only while uppsc was the sole exam with chapters — but M15 makes "draft from the
 * corresponding UPPSC chapter" the RECOMMENDED starting point for a second exam, so
 * a carried-over UPPSC pyq_id would resolve cleanly here, load with NO warning, and
 * render a reader chip deep-linking to another exam's question. The two failure
 * kinds are reported separately because they mean different things: a nonexistent id
 * is a typo/truncation, a cross-exam id is a copied draft that was never re-grounded.
 *
 * `questionExamScopeFilter` is the established notion of "belongs to this exam"
 * (paper_code in the exam's syllabus papers, OR a CURRENT_AFFAIRS question generated
 * for it) — deliberately NOT `questions.exam_code`, which is provenance and whose
 * domain includes exams we ingest PYQs from but never sell (`up_ro_aro`,
 * `upsssc_pet`) whose papers ARE legitimately part of the default exam's bank.
 *
 * No `selectAll` paging needed: every read here is bounded by an `.in()` of at most
 * ID_CHUNK ids, so it can never approach PostgREST's 1000-row cap.
 *
 * Exported (though only used by `assembleChapter` below) so this guard can be
 * exercised directly against the live DB without invoking the WRITING assemble
 * path — the only way to verify it read-only.
 */
export async function validatePyqIds(
  input: ChapterAssembleInput,
): Promise<{ missing: string[]; foreign: ForeignPyqRef[]; examCode: string }> {
  const ids = new Set<string>();
  for (const s of input.sections) {
    s.pyq_ids.forEach((id) => ids.add(id));
    s.boxes.forEach((b) => b.pyq_ids.forEach((id) => ids.add(id)));
  }
  const examCode = await examCodeForNode(input.node_id);
  if (ids.size === 0) return { missing: [], foreign: [], examCode };

  const scope = await questionExamScopeFilter(examCode);
  const exists = new Map<string, string | null>();
  const inExam = new Set<string>();
  for (const part of chunk([...ids], ID_CHUNK)) {
    const all = await supabase().from("questions").select("id, paper_code").in("id", part);
    if (all.error) throw new Error(`pyq_id existence check failed: ${all.error.message}`);
    ((all.data ?? []) as { id: string; paper_code: string | null }[]).forEach((r) => exists.set(r.id, r.paper_code));

    const scoped = await supabase().from("questions").select("id").in("id", part).or(scope);
    if (scoped.error) throw new Error(`pyq_id exam-scope check failed: ${scoped.error.message}`);
    ((scoped.data ?? []) as { id: string }[]).forEach((r) => inExam.add(r.id));
  }

  const foreignIds = [...ids].filter((id) => exists.has(id) && !inExam.has(id));
  // One extra read only when something is actually out of scope, so the clean
  // path (every rollout that is doing the right thing) costs nothing.
  const owners = foreignIds.length > 0 ? await paperCodeOwners() : new Map<string, string>();

  return {
    missing: [...ids].filter((id) => !exists.has(id)),
    foreign: foreignIds.map((id) => {
      const paperCode = exists.get(id) ?? null;
      return { id, paperCode, ownerExam: (paperCode && owners.get(paperCode)) || null };
    }),
    examCode,
  };
}

export interface AssembleChapterResult {
  noteId: string;
  /** Nonexistent ids stripped from the chapter before persisting (see below). */
  droppedMissing: string[];
}

/**
 * DISPOSITION OF A BAD `pyq_id` — the two kinds are treated DIFFERENTLY on
 * purpose (docs/OUTSTANDING.md M44, decided 2026-08-01):
 *
 *   `foreign` (exists, but outside this node's exam) → **HARD FAILURE.** Nothing
 *   is persisted and the CLI exits non-zero. The id RESOLVES, which is proof the
 *   author had a real question in hand — just the wrong exam's. Under M15 the
 *   recommended workflow is to draft a second exam's chapter FROM the
 *   corresponding UPPSC one, so a carried-over chip is the single most likely
 *   defect in a cross-exam rollout, and it is one the loader cannot repair:
 *   dropping can only remove a wrong chip, never supply the right one, so
 *   "warn and drop" silently shipped a chapter with no PYQ chips at all while
 *   still reporting success. There IS a correct answer available (the node's own
 *   context pack), so refusing forces it to be used.
 *
 *   `missing` (in no `questions` row at all) → **warn and drop, unchanged.** A
 *   nonexistent id is a typo or a truncated uuid; there is no correct id to
 *   recover, so dropping is strictly better than persisting a dead reader chip.
 *   Refusing here would also buy nothing durable: `validatePyqIds` runs ONLY at
 *   assemble time and nothing re-validates a persisted chapter, so chips rot
 *   afterwards anyway when a question is deleted (A11 — 12 such ids are live in
 *   8 published chapters today). The drop is now REPORTED in the CLI summary
 *   instead of vanishing into an `N/M assembled` line.
 */
export async function assembleChapter(
  input: ChapterAssembleInput,
  log: (m: string) => void = () => {},
): Promise<AssembleChapterResult> {
  const { missing, foreign, examCode } = await validatePyqIds(input);
  // Refuse BEFORE any write, so a rejected chapter leaves no partial row behind.
  if (foreign.length > 0) throw new ForeignPyqIdsError(input.node_id, examCode, foreign);
  if (missing.length > 0) {
    log(`  (warn) ${missing.length} referenced pyq_id(s) not in the bank — dropping them: ${missing.join(", ")}`);
  }
  if (missing.length > 0) {
    const drop = new Set(missing);
    for (const s of input.sections) {
      s.pyq_ids = s.pyq_ids.filter((id) => !drop.has(id));
      s.boxes.forEach((b) => (b.pyq_ids = b.pyq_ids.filter((id) => !drop.has(id))));
    }
  }

  const result = await persistChapter({
    nodeId: input.node_id,
    sections: input.sections,
    factAuditFacts: input.fact_audit_facts,
    sources: input.sources,
    overviewI18n: input.overview_i18n,
    quickRevisionI18n: input.quick_revision_i18n,
    model: "claude-code-agent",
    costUsd: 0,
    meta: {
      prompt_version: CHAPTER_PROMPT_VERSION,
      web_search_used: input.web_search_used,
      machine_translated: input.machine_translated,
      section_plan: input.section_plan,
      authored_by: "claude-code-agent",
      assembled: true,
    },
  });
  log(
    `  ✓ node ${input.node_id} → chapter v${result.chapterVersion}, ${result.sectionCount} sections, ` +
      `${result.factCount} facts (${result.factSummary.verified} verified / ${result.factSummary.flagged} flagged / ${result.factSummary.unverifiable} unverifiable)`,
  );
  return { noteId: result.noteId, droppedMissing: missing };
}

async function main(): Promise<void> {
  const args = parseArgs(
    process.argv.slice(2),
    // The old private parser here read `argv[i + 1] ?? ""` with NO `i++`, so a
    // valueless `--dir` took the literal string `"--file"` as its value — which
    // passed the truthiness check below and reached readdirSync(), and a
    // valueless `--file` would have been handed to readFileSync() the same way.
    { value: ["file", "dir"] },
    "notes:chapter:assemble",
  );
  const fileArg = typeof args.file === "string" && args.file ? args.file : null;
  const dirArg = typeof args.dir === "string" && args.dir ? args.dir : null;
  const files: string[] = [];
  if (fileArg) files.push(fileArg);
  if (dirArg) {
    for (const f of readdirSync(dirArg)) if (f.endsWith(".json")) files.push(join(dirArg, f));
  }
  if (files.length === 0) throw new Error("usage: notes:chapter:assemble --file <path.json> | --dir <dir>");

  console.log(`notes:chapter:assemble — ${files.length} file(s)\n`);
  let ok = 0;
  const refused: string[] = [];
  const failed: string[] = [];
  const withDrops: { file: string; dropped: string[] }[] = [];
  for (const f of files) {
    try {
      const parsed = chapterAssembleInputSchema.parse(JSON.parse(readFileSync(f, "utf8")));
      console.log(`[${f}]`);
      const res = await assembleChapter(parsed, (m) => console.log(m));
      ok++;
      if (res.droppedMissing.length > 0) withDrops.push({ file: f, dropped: res.droppedMissing });
    } catch (err) {
      if (err instanceof ForeignPyqIdsError) {
        refused.push(f);
        console.error(`  ✗ REFUSED ${f}\n    ${err.message}`);
      } else {
        failed.push(f);
        console.error(`  ✗ ${f}: ${err instanceof z.ZodError ? JSON.stringify(err.issues.slice(0, 3)) : (err as Error).message}`);
      }
    }
  }

  // The old summary was a bare `N/M chapter(s) assembled`, which reported 30/30
  // for a rollout in which a copied chapter had every chip silently stripped
  // (M44). Drops and refusals are now first-class lines, and any refusal or
  // error exits non-zero so a batch script cannot treat the run as clean.
  console.log(
    `\nassembled ${ok} · refused ${refused.length} (foreign pyq_ids) · failed ${failed.length} · of ${files.length} file(s)`,
  );
  if (withDrops.length > 0) {
    console.log(
      `${withDrops.length} assembled chapter(s) lost pyq_id chip(s) that are not in the bank ` +
        `(assembled anyway — see the disposition note in assembleChapter):`,
    );
    for (const d of withDrops) console.log(`  - ${d.file}: dropped ${d.dropped.length} → ${d.dropped.join(", ")}`);
  }
  for (const f of refused) console.log(`REFUSED (nothing written): ${f}`);
  if (ok > 0) console.log(`\nAssembled chapters are → needs_review. Review + publish at /<locale>/review (Notes tab).`);
  if (refused.length > 0 || failed.length > 0) process.exitCode = 1;
}

// Run as CLI only (not when imported by the generate path).
if (process.argv[1] && process.argv[1].endsWith("chapter-assemble.ts")) {
  main().catch((err) => {
    console.error("\nnotes:chapter:assemble failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
