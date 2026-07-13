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
import {
  auditedFactSchema,
  chapterSectionSchema,
  noteSourceSchema,
  bilingualTextSchema,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";
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

/** Validate every real pyq_id referenced actually exists in the bank (id-linked chips must resolve). */
async function validatePyqIds(input: ChapterAssembleInput): Promise<string[]> {
  const ids = new Set<string>();
  for (const s of input.sections) {
    s.pyq_ids.forEach((id) => ids.add(id));
    s.boxes.forEach((b) => b.pyq_ids.forEach((id) => ids.add(id)));
  }
  if (ids.size === 0) return [];
  const { data } = await supabase().from("questions").select("id").in("id", [...ids]);
  const found = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  return [...ids].filter((id) => !found.has(id));
}

export async function assembleChapter(input: ChapterAssembleInput, log: (m: string) => void = () => {}): Promise<string> {
  const missing = await validatePyqIds(input);
  if (missing.length > 0) {
    log(`  (warn) ${missing.length} referenced pyq_id(s) not in the bank — dropping them: ${missing.join(", ")}`);
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
  return result.noteId;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const files: string[] = [];
  if (args.file) files.push(args.file);
  if (args.dir) {
    for (const f of readdirSync(args.dir)) if (f.endsWith(".json")) files.push(join(args.dir, f));
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
