/**
 * `pnpm notes:coverage --exam <code> [--out <path.md>] [--json]`
 *
 * Study-chapter coverage for one exam, read LIVE from the database: every
 * syllabus node, its paper, depth, rolled-up PYQ weightage, and whether it has a
 * chapter — ordered by weightage descending, i.e. in the order a rollout should
 * author them.
 *
 * WHY THIS EXISTS. Sessions 28.5 and 29 rolled 284 chapters out for `uppsc`
 * using session-scratch context packs and a hand-kept batch list. Two things
 * went wrong and both are the same failure: state that lives only in a session.
 *   - The `ctx-*` context-pack directories did NOT survive a session restart,
 *     so the next session had to re-derive the whole worklist from scratch.
 *   - A manual off-by-two while listing "the final 13" silently skipped 2 GS5
 *     nodes; it was caught only because a per-paper coverage COUNT disagreed
 *     with a running tally kept in conversation.
 * Session 28.5's own note draws the conclusion: "the per-paper coverage count,
 * not a running mental tally, is the trustworthy source of 'is this paper
 * actually done'." This is that count, committed, regenerable in one command,
 * and diffable — so "which nodes are left" is answered by `git`, never by
 * remembering.
 *
 * PAGING IS NOT OPTIONAL HERE. PostgREST silently truncates any select at 1000
 * rows. `syllabus_nodes` is ~500 rows, `notes` ~300 and `mv_node_weightage`
 * ~900 today — all under the cap, all growing, and the failure mode is a report
 * that quietly UNDER-counts coverage rather than erroring. Session 28.5's own
 * audit script was bitten by exactly this and emitted 97 false "missing
 * embedding" reports. Every read below goes through `selectAll`, and
 * `loadNodeWeightage` pages internally.
 */
import { writeFileSync } from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/ingest/_shared.js";
import { supabase } from "../src/lib/supabase.js";
import { selectAll } from "../src/lib/paginate.js";
import { loadNodeWeightage } from "../src/lib/weightage.js";
import { hasChapter, unresolvedFlagCount, type FactAudit, type StudyContent } from "@neev/shared";

interface NodeRow {
  id: string;
  exam_code: string;
  paper_code: string;
  path: string;
  depth: number;
  title_i18n: { en?: string; hi?: string };
}

interface NoteRow {
  id: string;
  syllabus_node_id: string;
  status: string;
  chapter_version: number;
  model: string | null;
  study_content_i18n: StudyContent | null;
  fact_audit: FactAudit | null;
}

export interface CoverageRow {
  node_id: string;
  title: string;
  paper_code: string;
  depth: number;
  /** Subtree-rolled PYQ count (own + descendants), the same roll-up the chapter pipeline ranks by. */
  weightage: number;
  /** null = no `notes` row at all. */
  status: string | null;
  chapter_version: number;
  /** A note row can exist as a legacy DIGEST with no chapter — that is NOT coverage. */
  has_chapter: boolean;
  unresolved_flags: number;
  model: string | null;
}

export interface CoverageReport {
  exam_code: string;
  generated_on: string;
  /** depth-0 paper roots — never chaptered, excluded from every denominator. */
  roots: number;
  rows: CoverageRow[];
}

export async function buildCoverage(examCode: string): Promise<CoverageReport> {
  const nodes = await selectAll<NodeRow>(() =>
    supabase()
      .from("syllabus_nodes")
      .select("id, exam_code, paper_code, path, depth, title_i18n")
      .eq("exam_code", examCode)
      .order("id", { ascending: true }),
  );
  if (nodes.length === 0) throw new Error(`no syllabus_nodes for exam "${examCode}" — is the tree ingested?`);

  const notes = await selectAll<NoteRow>(() =>
    supabase()
      .from("notes")
      .select("id, syllabus_node_id, status, chapter_version, model, study_content_i18n, fact_audit")
      .order("id", { ascending: true }),
  );
  const noteByNode = new Map<string, NoteRow>();
  for (const n of notes) noteByNode.set(n.syllabus_node_id, n);

  // Bare, then intersected by node id — deliberately the SAME shape
  // `notes/generate.ts::topWeightageNodes` uses, so this report's ordering is
  // byte-for-byte the order `notes:chapter:context --paper X --top N` picks.
  // Scoping the matview call by exam instead would be defensible but could
  // diverge from that tool, and a checklist that disagrees with the dumper is
  // worse than one that shares its (documented, §1c) quirk.
  const weight = await loadNodeWeightage();

  const rows: CoverageRow[] = [];
  for (const n of nodes) {
    if (n.depth === 0) continue; // paper root — a chapter on "Mains — GS II" is not a thing
    const prefix = n.path ? `${n.path}/` : "";
    let total = 0;
    for (const d of nodes) {
      if (d.paper_code !== n.paper_code) continue;
      if (d.path === n.path || (prefix && d.path.startsWith(prefix))) total += weight.get(d.id)?.total ?? 0;
    }
    const note = noteByNode.get(n.id) ?? null;
    rows.push({
      node_id: n.id,
      title: n.title_i18n?.en ?? "(untitled)",
      paper_code: n.paper_code,
      depth: n.depth,
      weightage: total,
      status: note?.status ?? null,
      chapter_version: note?.chapter_version ?? 0,
      has_chapter: hasChapter(note?.study_content_i18n),
      unresolved_flags: unresolvedFlagCount(note?.fact_audit),
      model: note?.model ?? null,
    });
  }
  rows.sort((a, b) => b.weightage - a.weightage || a.paper_code.localeCompare(b.paper_code) || a.title.localeCompare(b.title));

  return {
    exam_code: examCode,
    generated_on: new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10),
    roots: nodes.filter((n) => n.depth === 0).length,
    rows,
  };
}

/** "Covered" = a PUBLISHED chapter. A draft or a digest-only note is not coverage. */
const covered = (r: CoverageRow): boolean => r.has_chapter && r.status === "published";

function statusCell(r: CoverageRow): string {
  if (!r.status) return "— none";
  if (!r.has_chapter) return `digest only (${r.status})`;
  const flags = r.unresolved_flags > 0 ? ` · ${r.unresolved_flags} unresolved flag(s)` : "";
  return `${r.status} · chapter v${r.chapter_version}${flags}`;
}

function renderMarkdown(rep: CoverageReport, cmd: string): string {
  const total = rep.rows.length;
  const done = rep.rows.filter(covered).length;
  const pct = total ? Math.round((done / total) * 1000) / 10 : 0;

  const byPaper = new Map<string, { total: number; done: number; weight: number }>();
  for (const r of rep.rows) {
    const cur = byPaper.get(r.paper_code) ?? { total: 0, done: 0, weight: 0 };
    cur.total++;
    cur.weight += r.weightage;
    if (covered(r)) cur.done++;
    byPaper.set(r.paper_code, cur);
  }

  const out: string[] = [];
  out.push(`# Study-chapter coverage — \`${rep.exam_code}\``);
  out.push("");
  out.push(`> **Generated file — do not hand-edit.** Regenerate with:`);
  out.push(`>`);
  out.push("> ```");
  out.push(`> ${cmd}`);
  out.push("> ```");
  out.push(`>`);
  out.push(
    `> Read live from the database on **${rep.generated_on}** (IST). Every query is paged ` +
      `(\`selectAll\`) — PostgREST truncates a bare select at 1000 rows and this report would ` +
      `silently UNDER-report coverage rather than fail.`,
  );
  out.push("");
  out.push(
    `**${done} of ${total} chapterable nodes have a published chapter (${pct}%).** ` +
      `The exam has **${total + rep.roots}** syllabus nodes in total; the **${rep.roots}** depth-0 paper roots ` +
      `are excluded from every denominator here because a chapter is authored per topic, not per paper ` +
      `(\`notes/generate.ts::topWeightageNodes\` filters \`depth >= 1\`, and \`uppsc\`'s complete rollout is ` +
      `284 chapters over 294 nodes — exactly its 10 roots short).`,
  );
  out.push("");
  out.push(
    `"Covered" means a **published** chapter: a \`notes\` row whose \`study_content_i18n.sections\` is ` +
      `non-empty AND whose \`status\` is \`published\`. A legacy digest-only note, a draft, or a chapter ` +
      `still holding unresolved fact-audit flags is **not** coverage and is listed as such.`,
  );
  out.push("");
  out.push(`## Per paper`);
  out.push("");
  out.push(`| Paper | Chaptered | Nodes | % | Remaining | PYQ weight |`);
  out.push(`| --- | ---: | ---: | ---: | ---: | ---: |`);
  for (const [paper, v] of [...byPaper.entries()].sort((a, b) => b[1].weight - a[1].weight)) {
    const p = v.total ? Math.round((v.done / v.total) * 1000) / 10 : 0;
    out.push(`| \`${paper}\` | ${v.done} | ${v.total} | ${p}% | ${v.total - v.done} | ${v.weight} |`);
  }
  out.push(`| **all** | **${done}** | **${total}** | **${pct}%** | **${total - done}** | ${rep.rows.reduce((a, r) => a + r.weightage, 0)} |`);
  out.push("");
  out.push(`## Every node, heaviest first`);
  out.push("");
  out.push(
    `This ordering **is the worklist**: the next node to author is the topmost row whose Chapter column ` +
      `reads \`— none\`. Dump its pack with \`pnpm notes:chapter:context --node <node_id> --dir <dir>\`. ` +
      `Weightage is the subtree roll-up (own + descendants) from \`mv_node_weightage\`, the same number ` +
      `\`topWeightageNodes\` ranks by — so a depth-1 section and its own depth-2 children both appear, and ` +
      `both are legitimately chaptered (that is how \`uppsc\` is covered).`,
  );
  out.push("");
  out.push(`| # | Weight | Paper | D | Node | Chapter | node_id |`);
  out.push(`| ---: | ---: | --- | ---: | --- | --- | --- |`);
  rep.rows.forEach((r, i) => {
    const title = r.title.replace(/\|/g, "\\|");
    out.push(
      `| ${i + 1} | ${r.weightage} | \`${r.paper_code}\` | ${r.depth} | ${title} | ${statusCell(r)} | \`${r.node_id}\` |`,
    );
  });
  out.push("");
  return out.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), { value: ["exam", "out"], boolean: ["json"] }, "notes:coverage");
  const exam = typeof args.exam === "string" ? args.exam : null;
  if (!exam) throw new Error("usage: notes:coverage --exam <code> [--out <path.md>] [--json]");
  const rep = await buildCoverage(exam);

  if (args.json === true) {
    process.stdout.write(JSON.stringify(rep, null, 2) + "\n");
    return;
  }
  const outPath = typeof args.out === "string" ? args.out : null;
  // The command printed INTO the generated file must be repo-root-relative and
  // reproducible from anywhere, never whatever `--out` happened to be typed
  // from `apps/api` — and never an absolute path (`check:paths` fails CI on a
  // machine-specific one baked into a tracked file, exactly the M46 shape).
  // ROOT is derived from import.meta.url per the portability rule.
  const ROOT = resolve(fileURLToPath(import.meta.url), "../../../..");
  // A RELATIVE `--out` resolves against the REPO ROOT, never `process.cwd()`.
  // The documented invocation is `pnpm notes:coverage … --out docs/<exam>-chapter-coverage.md`
  // from the repo root, and the root script delegates via `pnpm --filter api`, which
  // re-runs the CLI with cwd=`apps/api` — so a cwd-relative write ENOENT'd on
  // `apps/api/docs/`, i.e. the exact command this file prints into its own header
  // could not be run. (It also made `cmd` render `--out apps/api/docs/…`.) Anchoring
  // both on ROOT is the same portability rule the rest of the repo follows: the
  // command now works identically from the repo root, from inside apps/api and in CI.
  // An ABSOLUTE `--out` is unaffected — `resolve()` returns it unchanged.
  const outAbs = outPath ? resolve(ROOT, outPath) : null;
  const cmd = `pnpm notes:coverage --exam ${exam}${outAbs ? ` --out ${relative(ROOT, outAbs)}` : ""}`;
  const md = renderMarkdown(rep, cmd);
  if (outAbs) {
    writeFileSync(outAbs, md);
    const done = rep.rows.filter(covered).length;
    console.log(`✓ ${relative(ROOT, outAbs)} — ${done}/${rep.rows.length} chapterable ${exam} nodes have a published chapter`);
  } else {
    process.stdout.write(md);
  }
}

if (process.argv[1] && process.argv[1].endsWith("chapter-coverage.ts")) {
  main().catch((err) => {
    console.error("notes:coverage failed:", err instanceof Error ? err.stack : err);
    process.exit(1);
  });
}
