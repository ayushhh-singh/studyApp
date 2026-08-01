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
): Promise<{ missing: string[]; foreign: string[]; examCode: string }> {
  const ids = new Set<string>();
  for (const s of input.sections) {
    s.pyq_ids.forEach((id) => ids.add(id));
    s.boxes.forEach((b) => b.pyq_ids.forEach((id) => ids.add(id)));
  }
  const examCode = await examCodeForNode(input.node_id);
  if (ids.size === 0) return { missing: [], foreign: [], examCode };

  const scope = await questionExamScopeFilter(examCode);
  const exists = new Set<string>();
  const inExam = new Set<string>();
  for (const part of chunk([...ids], ID_CHUNK)) {
    const all = await supabase().from("questions").select("id").in("id", part);
    if (all.error) throw new Error(`pyq_id existence check failed: ${all.error.message}`);
    ((all.data ?? []) as { id: string }[]).forEach((r) => exists.add(r.id));

    const scoped = await supabase().from("questions").select("id").in("id", part).or(scope);
    if (scoped.error) throw new Error(`pyq_id exam-scope check failed: ${scoped.error.message}`);
    ((scoped.data ?? []) as { id: string }[]).forEach((r) => inExam.add(r.id));
  }

  return {
    missing: [...ids].filter((id) => !exists.has(id)),
    foreign: [...ids].filter((id) => exists.has(id) && !inExam.has(id)),
    examCode,
  };
}

export async function assembleChapter(input: ChapterAssembleInput, log: (m: string) => void = () => {}): Promise<string> {
  const { missing, foreign, examCode } = await validatePyqIds(input);
  if (missing.length > 0) {
    log(`  (warn) ${missing.length} referenced pyq_id(s) not in the bank — dropping them: ${missing.join(", ")}`);
  }
  if (foreign.length > 0) {
    log(
      `  (warn) ${foreign.length} referenced pyq_id(s) belong to a DIFFERENT exam than this node ` +
        `(node exam: ${examCode}) — dropping them: ${foreign.join(", ")}. ` +
        `This usually means the chapter was drafted from another exam's chapter and its PYQ chips ` +
        `were carried over without being re-grounded in this exam's own bank.`,
    );
  }
  const drop = new Set([...missing, ...foreign]);
  if (drop.size > 0) {
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
  return result.noteId;
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
  for (const f of files) {
    try {
      const parsed = chapterAssembleInputSchema.parse(JSON.parse(readFileSync(f, "utf8")));
      console.log(`[${f}]`);
      await assembleChapter(parsed, (m) => console.log(m));
      ok++;
    } catch (err) {
      console.error(`  ✗ ${f}: ${err instanceof z.ZodError ? JSON.stringify(err.issues.slice(0, 3)) : (err as Error).message}`);
    }
  }
  console.log(`\n${ok}/${files.length} chapter(s) assembled → needs_review. Review + publish at /<locale>/review (Notes tab).`);
}

// Run as CLI only (not when imported by the generate path).
if (process.argv[1] && process.argv[1].endsWith("chapter-assemble.ts")) {
  main().catch((err) => {
    console.error("\nnotes:chapter:assemble failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
