/**
 * ingest:upsc-syllabus — load the HAND-AUTHORED UPSC syllabus tree into
 * `syllabus_nodes`, gated by a verbatim official-text coverage check.
 *
 *   pnpm ingest:upsc-syllabus [--verify-only] [--dry-run] [--paper UPSC_MAINS_GS1]
 *                             [--write-artifact docs/upsc-syllabus-coverage.md] [--write]
 *
 * MODES — three of the four are read-only. Only a BARE invocation (or an
 * explicit `--write`) touches the database, and this repo uses the SAME Supabase
 * project for dev and prod, so the distinction matters:
 *   --verify-only      run the coverage gate; no DB access at all.
 *   --dry-run          verify + print the tree that WOULD be written.
 *   --write-artifact P verify + emit the coverage artifact to P, then STOP.
 *   --write            with --write-artifact: emit the artifact AND upsert.
 *   (no flags)         verify → refuse on any defect → upsert.
 *
 * DETERMINISTIC AND ZERO-LLM. This script makes NO Anthropic or OpenAI call, no
 * `translate()`, and never touches `exam-config`. The tree and its verbatim
 * source lines are hand-authored data files (`upsc-syllabus-tree.ts`,
 * `upsc-official-lines.ts`); this is only the consumer. See
 * `upsc-syllabus-types.ts` for why `ingest:syllabus` cannot be reused here.
 *
 * Flow:
 *   1. verifyCoverage() — pure, no DB, no network. Nothing missed (every
 *      official line claimed) + nothing invented (every node covers real text)
 *      + structural/bilingual/referential integrity.
 *   2. Refuse to write on ANY defect.
 *   3. Idempotent upsert on (paper_code, path), parents before children.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { supabase } from "../../lib/supabase.js";
import {
  ROOT,
  PAPERS,
  assertPaperCodeScoped,
  parseArgs,
  report,
  type PaperDef,
} from "../_shared.js";
import { UPSC_OFFICIAL_LINES } from "./upsc-official-lines.js";
import { UPSC_SYLLABUS_TREE } from "./upsc-syllabus-tree.js";
import {
  verifyCoverage,
  nodeKey,
  depthOf,
  parentPathOf,
  type CoverageResult,
  type CoverageIssue,
} from "./verify-coverage.js";
import type { OfficialSyllabusLine, SeedNode } from "./upsc-syllabus-types.js";

const UPSC_EXAM = "upsc" as const;

/** The 7 in-scope UPSC papers, read from the single source of truth in _shared.ts. */
function upscPapers(): PaperDef[] {
  return PAPERS.filter((p) => p.exam === UPSC_EXAM);
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------
function printIssues(title: string, issues: CoverageIssue[], kind: "fail" | "warn"): void {
  if (issues.length === 0) return;
  report.section(`${title} (${issues.length})`);
  const byKind = new Map<string, CoverageIssue[]>();
  for (const i of issues) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), i]);
  for (const k of [...byKind.keys()].sort()) {
    const group = byKind.get(k)!;
    report.step(`${k} × ${group.length}`);
    for (const i of group) {
      const line = `[${i.paperCode ?? "—"}] ${i.subject}: ${i.message}`;
      if (kind === "fail") report.fail(line);
      else report.warn(line);
    }
  }
}

function printCoverage(result: CoverageResult): void {
  report.section("Shape per paper  (grain check — the UPPSC tree is max-depth-2 everywhere)");
  if (result.perPaper.length === 0) {
    report.warn("no papers have any authored nodes or official lines yet");
  } else {
    console.log(
      `  ${"paper".padEnd(20)} ${"nodes".padStart(6)} ${"d1".padStart(4)} ${"d2".padStart(4)} ${"leaves".padStart(7)} ` +
        `${"maxD".padStart(5)} ${"lines".padStart(6)} ${"covered".padStart(8)} ${"official".padStart(9)} ${"editorial".padStart(10)}`,
    );
    console.log("  " + "-".repeat(96));
    for (const p of result.perPaper) {
      console.log(
        `  ${p.paperCode.padEnd(20)} ${String(p.nodes).padStart(6)} ${String(p.depth1).padStart(4)} ${String(p.depth2).padStart(4)} ` +
          `${String(p.leaves).padStart(7)} ${String(p.maxDepth).padStart(5)} ${String(p.lines).padStart(6)} ` +
          `${String(p.linesCovered).padStart(8)} ${String(p.officialLineNodes).padStart(9)} ${String(p.editorialSubdivisionNodes).padStart(10)}`,
      );
    }
    console.log("  " + "-".repeat(96));
  }
  const t = result.totals;
  report.section("Totals");
  console.log(`  papers with data        ${String(t.papers).padStart(6)}`);
  console.log(`  authored nodes          ${String(t.nodes).padStart(5)}  (leaves: ${t.leaves}; paper roots are implicit)`);
  console.log(`  official lines          ${String(t.lines).padStart(5)}`);
  console.log(`  lines covered           ${String(t.linesCovered).padStart(5)}  unmapped: ${t.linesUnmapped}`);
  console.log(`  derivation: official    ${String(t.officialLineNodes).padStart(5)}  (scope IS official text)`);
  console.log(`  derivation: editorial   ${String(t.editorialSubdivisionNodes).padStart(5)}  (title is NOT official text — audited below)`);
  console.log(`  defects                 ${String(t.defects).padStart(5)}`);
  console.log(`  info notes              ${String(t.infos).padStart(5)}`);
}

/**
 * Every node whose title is NOT literal official text, with the official lines
 * it refines and its rationale. Printed as its own prominent section, NOT folded
 * into the generic info list: this table is the auditable answer to "no invented
 * topics" and is meant to be handed to a reviewer.
 */
function printEditorialSubdivisions(result: CoverageResult): void {
  const subs = result.editorialSubdivisions;
  report.section(
    `EDITORIAL SUBDIVISIONS — nodes whose title is NOT official text (${subs.length}) — review these`,
  );
  if (subs.length === 0) {
    report.ok("none — every authored node's scope is literal official syllabus text");
    return;
  }
  report.step(
    "Each is a conventional study unit subdividing an official line's scope (the UPPSC broad-leaf convention). " +
      "All still trace to official text; they are listed because their TITLES do not appear in it.",
  );
  for (const paperCode of [...new Set(subs.map((s) => s.paperCode))].sort()) {
    console.log(`\n  [${paperCode}]`);
    for (const s of subs.filter((x) => x.paperCode === paperCode)) {
      console.log(`    ${s.path}  — ${s.titleEn}`);
      console.log(`      refines: ${s.refines.length ? s.refines.join(", ") : "(none — see defects)"}`);
      console.log(`      why:     ${s.rationale || "(no rationale — see defects)"}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Coverage-mapping artifact (markdown) — the deliverable proving nothing was missed
// ---------------------------------------------------------------------------
function renderArtifact(
  lines: readonly OfficialSyllabusLine[],
  tree: readonly SeedNode[],
  result: CoverageResult,
): string {
  const out: string[] = [];
  out.push("# UPSC syllabus — coverage mapping artifact");
  out.push("");
  out.push(
    "Generated by `pnpm ingest:upsc-syllabus --write-artifact <path>` from the hand-authored " +
      "data files (`apps/api/src/ingest/seed/upsc-official-lines.ts`, `upsc-syllabus-tree.ts`). " +
      "Deterministic, zero-LLM: this file is a pure rendering of those two arrays.",
  );
  out.push("");
  out.push(
    `**Status: ${result.ok ? "PASS — 0 defects" : `FAIL — ${result.totals.defects} defect(s)`}** · ` +
      `${result.totals.lines} official lines · ${result.totals.linesCovered} covered · ` +
      `${result.totals.linesUnmapped} unmapped · ${result.totals.nodes} nodes ` +
      `(${result.totals.officialLineNodes} official-text, ${result.totals.editorialSubdivisionNodes} editorial) · ` +
      `${result.totals.infos} info note(s)`,
  );
  out.push("");

  // --- Per-paper shape summary (grain check vs the UPPSC tree) ---
  out.push("## Per-paper shape summary");
  out.push("");
  out.push(
    "Proves the tree matches the UPPSC grain the rest of the platform reasons about: " +
      `**max depth is capped at 2** (the UPPSC tree bottoms out at depth 2 in all 10 papers), ` +
      "so weightage rollup, qgen targeting and the chapter rollout stay comparable across exams. " +
      "A depth-3 node is a defect.",
  );
  out.push("");
  out.push("| paper | nodes | d1 | d2 | leaves | max depth | official lines | covered | official-text nodes | editorial subdivisions |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const p of result.perPaper) {
    out.push(
      `| \`${p.paperCode}\` | ${p.nodes} | ${p.depth1} | ${p.depth2} | ${p.leaves} | ${p.maxDepth} | ${p.lines} | ` +
        `${p.linesCovered} | ${p.officialLineNodes} | ${p.editorialSubdivisionNodes} |`,
    );
  }
  out.push("");

  // --- Editorial subdivisions: the audit table ---
  out.push("## Editorial subdivisions — every node whose title is NOT official text");
  out.push("");
  out.push(
    "**This is the honest answer to \"no invented topics\".** UPSC Prelims publishes only 7 official bullets " +
      "(Paper I) and 6 (Paper II), while the UPPSC `PRE_GS1` tree we mirror for grain has 31 nodes with " +
      "deliberately broad leaves. Matching that grain means subdividing one official bullet into several " +
      "conventional study units, so \"nothing invented\" cannot mean \"every title is a literal official phrase\". " +
      "It means: **every node traces to official text, and every node that is not literal official text is " +
      "declared here with its rationale.** Every row below still passes the reverse coverage check.",
  );
  out.push("");
  out.push(
    `Totals: **${result.totals.officialLineNodes}** nodes whose scope IS official text · ` +
      `**${result.totals.editorialSubdivisionNodes}** declared editorial subdivision(s).`,
  );
  out.push("");
  if (result.editorialSubdivisions.length === 0) {
    out.push("None — every authored node's scope is literal official syllabus text.");
  } else {
    out.push("| paper | path | title (en) | refines official lines | rationale |");
    out.push("|---|---|---|---|---|");
    for (const s of result.editorialSubdivisions) {
      out.push(
        `| \`${s.paperCode}\` | \`${s.path}\` | ${mdCell(s.titleEn)} | ` +
          `${s.refines.length ? s.refines.map((i) => `\`${i}\``).join(" ") : "**— NONE —**"} | ${mdCell(s.rationale)} |`,
      );
    }
  }
  out.push("");

  // --- Forward table: official line -> node(s) ---
  out.push("## Forward mapping — every official line and the node(s) covering it");
  out.push("");
  out.push("The **nothing-missed** proof. An empty *Covered by* cell is a defect.");
  out.push("");
  const linePapers = [...new Set(lines.map((l) => l.paperCode))].sort();
  for (const paperCode of linePapers) {
    out.push(`### \`${paperCode}\``);
    out.push("");
    out.push("| line id | verbatim official text | source | covered by |");
    out.push("|---|---|---|---|");
    for (const l of lines.filter((x) => x.paperCode === paperCode)) {
      const claimants = (result.lineToNodes.get(l.id) ?? []).map((k) => `\`${k.split(":").slice(1).join(":")}\``);
      out.push(
        `| \`${l.id}\` | ${mdCell(l.text)} | ${mdCell(l.source)} | ${claimants.length ? claimants.join("<br>") : "**— UNMAPPED —**"} |`,
      );
    }
    out.push("");
  }

  // --- Reverse table: node -> lines ---
  out.push("## Reverse mapping — every node and the lines it covers");
  out.push("");
  out.push(
    "The **nothing-invented** proof. *Own* is what the node itself claims; *effective* is " +
      "own ∪ every descendant's, so a grouping section is legitimate when its children cover real text. " +
      "An empty *effective* cell is a defect.",
  );
  out.push("");
  const nodePapers = [...new Set(tree.map((n) => n.paperCode))].sort();
  for (const paperCode of nodePapers) {
    out.push(`### \`${paperCode}\``);
    out.push("");
    out.push("| depth | path | title (en) | derivation | own lines | effective lines |");
    out.push("|---|---|---|---|---|---|");
    const paperNodes = tree
      .filter((n) => n.paperCode === paperCode)
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const n of paperNodes) {
      const key = nodeKey(n.paperCode, n.path);
      const m = result.nodeToLines.get(key);
      const own = m?.own ?? [];
      const eff = m?.effective ?? [];
      const deriv = n.derivation === "editorial_subdivision" ? "editorial" : "official";
      out.push(
        `| ${depthOf(n.path)} | \`${n.path}\` | ${mdCell(n.title?.en ?? "")} | ${deriv} | ` +
          `${own.length ? own.map((i) => `\`${i}\``).join(" ") : "—"} | ` +
          `${eff.length ? `${eff.length}: ${eff.map((i) => `\`${i}\``).join(" ")}` : "**— NONE —**"} |`,
      );
    }
    out.push("");
  }

  // --- Defects + ambiguities ---
  out.push("## Defects");
  out.push("");
  if (result.defects.length === 0) {
    out.push("None. Every official line is covered and every node maps to real official text.");
  } else {
    out.push("| kind | paper | subject | detail |");
    out.push("|---|---|---|---|");
    for (const d of result.defects) {
      out.push(`| \`${d.kind}\` | \`${d.paperCode ?? "—"}\` | \`${d.subject}\` | ${mdCell(d.message)} |`);
    }
  }
  out.push("");

  // `editorial_subdivision` infos are excluded here — they have their own
  // dedicated table above, and duplicating ~30 rows would bury the rest.
  out.push("## Info notes (not defects)");
  out.push("");
  const otherInfos = result.infos.filter((i) => i.kind !== "editorial_subdivision");
  if (otherInfos.length === 0) {
    out.push("None.");
  } else {
    out.push("| kind | paper | subject | detail |");
    out.push("|---|---|---|---|");
    for (const i of otherInfos) {
      out.push(`| \`${i.kind}\` | \`${i.paperCode ?? "—"}\` | \`${i.subject}\` | ${mdCell(i.message)} |`);
    }
  }
  out.push("");
  return out.join("\n");
}

/** Escape a value so it cannot break out of a markdown table cell. */
function mdCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Dry-run tree print
// ---------------------------------------------------------------------------
function printTree(papers: PaperDef[], tree: readonly SeedNode[], result: CoverageResult): void {
  report.section("Tree that WOULD be written (dry-run)");
  for (const paper of papers) {
    // Sorted by PATH here so children nest visually under their parent. The
    // actual write uses sortForWrite() (shallow-first) so parent_id resolves —
    // a readable preview and a safe write order are different orderings.
    const paperNodes = tree
      .filter((n) => n.paperCode === paper.paperCode)
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path));
    console.log(`\n  [d0] ${paper.paperCode}  (root, path "")  — ${paper.title.en}`);
    for (const n of paperNodes) {
      const eff = result.nodeToLines.get(nodeKey(n.paperCode, n.path))?.effective.length ?? 0;
      console.log(
        `  ${"  ".repeat(depthOf(n.path))}[d${depthOf(n.path)}] ${n.path}  — ${n.title?.en ?? ""}  (${eff} line${eff === 1 ? "" : "s"})`,
      );
    }
    console.log(`  → ${paperNodes.length + 1} rows (root + ${paperNodes.length})`);
  }
}

// ---------------------------------------------------------------------------
// Write path — upsert semantics copied from ingest/syllabus.ts's upsertNode
// ---------------------------------------------------------------------------

/**
 * Parents MUST be written before children so `parent_id` resolves: shallow
 * first, then order_index among siblings, then path as a deterministic
 * tiebreak. Same ordering as `ingestPaper` in ingest/syllabus.ts.
 */
function sortForWrite(nodes: SeedNode[]): SeedNode[] {
  return [...nodes].sort(
    (a, b) => depthOf(a.path) - depthOf(b.path) || a.orderIndex - b.orderIndex || a.path.localeCompare(b.path),
  );
}

async function upsertNode(
  paper: PaperDef,
  path: string,
  parentId: string | null,
  title_i18n: { hi: string; en: string },
  description_i18n: { hi: string; en: string } | null,
  order_index: number,
  depth: number,
  meta: Record<string, unknown>,
): Promise<string> {
  const row = {
    // Conflict target is (paper_code, path) and is deliberately UNCHANGED —
    // exam_code is stamped as DATA, never as part of the key. Adding it to the
    // key would let two exams share a bare paper code, which the ~30
    // paper_code-only reads elsewhere would then silently mix. See
    // docs/multi-exam.md §0 and the same comment in ingest/syllabus.ts.
    exam_code: paper.exam,
    exam_stage: paper.stage,
    paper_code: paper.paperCode,
    path,
    parent_id: parentId,
    title_i18n,
    description_i18n,
    order_index,
    depth,
    meta,
  };
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .upsert(row, { onConflict: "paper_code,path" })
    .select("id")
    .single();
  if (error) throw new Error(`upsert ${paper.paperCode}/${path}: ${error.message}`);
  return data.id as string;
}

async function writePaper(
  paper: PaperDef,
  tree: readonly SeedNode[],
): Promise<{ rows: number }> {
  // Fail BEFORE any write: a mis-scoped paper code would upsert straight onto
  // another exam's tree through (paper_code, path).
  assertPaperCodeScoped(paper.exam, paper.paperCode);

  const built = sortForWrite(tree.filter((n) => n.paperCode === paper.paperCode));

  // Paper root (path '', depth 0, parent_id null) — implicit in the data.
  const rootId = await upsertNode(paper, "", null, paper.title, null, 0, 0, {
    source: "official_syllabus_hand_authored",
  });
  const idByPath = new Map<string, string>([["", rootId]]);

  for (const n of built) {
    const parentKey = parentPathOf(n.path);
    const parentId = idByPath.get(parentKey);
    if (parentId === undefined) {
      // Unreachable: verifyCoverage's missing_parent_path defect blocks the
      // write, and sortForWrite guarantees shallow-first. Fail loudly rather
      // than silently re-parenting to the root and corrupting the tree.
      throw new Error(
        `${paper.paperCode}/${n.path}: parent "${parentKey}" had no id when writing — tree order or verification is broken`,
      );
    }
    const meta: Record<string, unknown> = {
      source: "official_syllabus_hand_authored",
      official_lines: n.officialLines ?? [],
      // Persisted so the "is this node literal official text?" audit survives in
      // the DB, not only in the generated artifact.
      derivation: n.derivation,
    };
    if (n.derivation === "editorial_subdivision" && n.subdivisionRationale?.trim()) {
      meta.subdivision_rationale = n.subdivisionRationale.trim();
    }
    if (n.ambiguityNote?.trim()) meta.ambiguity_note = n.ambiguityNote.trim();
    const id = await upsertNode(
      paper,
      n.path,
      parentId,
      { en: n.title.en.trim(), hi: n.title.hi.trim() },
      n.description ? { en: n.description.en.trim(), hi: n.description.hi.trim() } : null,
      n.orderIndex,
      depthOf(n.path),
      meta,
    );
    idByPath.set(n.path, id);
  }
  report.ok(`${paper.paperCode}: upserted ${built.length + 1} nodes (root + ${built.length})`);
  return { rows: built.length + 1 };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const verifyOnly = !!args["verify-only"];
  const dryRun = !!args["dry-run"];
  const onlyPaper = typeof args.paper === "string" ? args.paper : null;
  const artifact = typeof args["write-artifact"] === "string" ? args["write-artifact"] : null;

  const mode = verifyOnly ? " (verify-only — no DB access)" : dryRun ? " (dry-run — no DB writes)" : "";
  report.section(`ingest:upsc-syllabus${mode}`);
  report.step("deterministic + zero-LLM: no Anthropic/OpenAI call is made by this script");

  const allPapers = upscPapers();
  let papers = allPapers;
  if (onlyPaper) {
    papers = allPapers.filter((p) => p.paperCode === onlyPaper);
    if (papers.length === 0) {
      throw new Error(
        `Unknown --paper ${onlyPaper}. Known UPSC papers: ${allPapers.map((p) => p.paperCode).join(", ")}`,
      );
    }
  }
  const scope = new Set(papers.map((p) => p.paperCode));

  // Verification always runs over the FULL authored data set, even under
  // --paper: an unmapped line or a cross-paper reference in another paper is
  // still a defect, and scoping the check would hide it.
  const result = verifyCoverage(
    UPSC_OFFICIAL_LINES,
    UPSC_SYLLABUS_TREE,
    allPapers.map((p) => p.paperCode),
  );

  printCoverage(result);
  printEditorialSubdivisions(result);
  printIssues("DEFECTS — these block the write", result.defects, "fail");
  // `editorial_subdivision` infos already had their own prominent section above.
  printIssues(
    "Info (legitimate, not blocking)",
    result.infos.filter((i) => i.kind !== "editorial_subdivision"),
    "warn",
  );

  if (artifact) {
    // Portable: an absolute path is honoured as given, a relative one resolves
    // against the repo ROOT (derived from import.meta.url in _shared.ts), never
    // against process.cwd() and never a hardcoded machine prefix.
    const outPath = isAbsolute(artifact) ? artifact : join(ROOT, artifact);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, renderArtifact(UPSC_OFFICIAL_LINES, UPSC_SYLLABUS_TREE, result), "utf8");
    // Show a repo-relative path when the file IS inside the repo, else the
    // absolute one — a `../../../..` traversal out of ROOT is just noise.
    const rel = relative(ROOT, outPath);
    report.ok(`coverage artifact → ${rel.startsWith("..") ? outPath : rel}`);

    // --write-artifact IS TERMINAL BY DEFAULT. Regenerating the docs artifact
    // must never imply a production DB write: this repo uses the SAME Supabase
    // project for dev and prod, so a docs refresh that silently upserts the
    // whole tree is a real hazard, not a theoretical one — the first run of this
    // flag did exactly that (202 rows) because it fell through to the write
    // path, which is why this guard exists. Pass `--write` alongside
    // `--write-artifact` to deliberately do both in one run.
    if (!verifyOnly && !dryRun && !args.write) {
      report.section("Result");
      if (!result.ok) {
        report.fail(
          `${result.totals.defects} defect(s) — artifact written for diagnosis, no DB write performed`,
        );
        process.exit(1);
      }
      report.ok(
        `artifact written — no DB write performed (${result.totals.lines} lines, ${result.totals.nodes} nodes). ` +
          "Pass --write to also upsert.",
      );
      return;
    }
  }

  if (verifyOnly) {
    report.section("Result");
    if (result.ok) {
      report.ok(`verification passed — 0 defects (${result.totals.lines} lines, ${result.totals.nodes} nodes)`);
      if (result.totals.lines === 0 && result.totals.nodes === 0) {
        // Empty input is a VACUOUS pass, not a defect — the data modules are
        // committed as empty placeholders so this loader typechecks and runs
        // before the authoring agents fill them. Loud, but exit 0.
        report.warn(
          "both data files are still empty placeholders — nothing has been authored yet, so this pass is vacuous",
        );
      }
      return;
    }
    report.fail(`verification FAILED — ${result.totals.defects} defect(s)`);
    process.exit(1);
  }

  if (!result.ok) {
    report.section("Refusing to write");
    report.fail(
      `${result.totals.defects} defect(s) — the coverage gate blocks any DB write. ` +
        "Fix the data files and re-run (--verify-only for a fast loop).",
    );
    process.exit(1);
  }

  // Separate from the coverage gate: an empty tree is not a coverage DEFECT
  // (there is nothing to be wrong about), but writing 7 bare paper roots with no
  // children would leave a real, half-ingested tree in the DB. Refuse.
  const inScope = UPSC_SYLLABUS_TREE.filter((n) => scope.has(n.paperCode));
  if (inScope.length === 0) {
    report.section("Refusing to write");
    report.fail(
      `no authored nodes for ${onlyPaper ?? "any UPSC paper"} — writing paper roots alone would leave an ` +
        "empty tree in the DB. Author the data files first (see upsc-syllabus-types.ts).",
    );
    process.exit(1);
  }
  const paperless = papers.filter((p) => !inScope.some((n) => n.paperCode === p.paperCode));
  if (paperless.length > 0) {
    report.section("Refusing to write");
    report.fail(
      `these in-scope papers have zero authored nodes: ${paperless.map((p) => p.paperCode).join(", ")} — ` +
        "use --paper to load one paper at a time, rather than writing bare roots.",
    );
    process.exit(1);
  }

  if (dryRun) {
    printTree(papers, UPSC_SYLLABUS_TREE, result);
    report.section("Summary");
    report.ok("dry-run — no DB write performed");
    return;
  }

  report.section("Upserting");
  let rows = 0;
  for (const paper of papers) {
    report.step(`→ [${paper.exam}] ${paper.paperCode} (${paper.title.en})`);
    const { rows: n } = await writePaper(paper, UPSC_SYLLABUS_TREE);
    rows += n;
  }
  report.section("Summary");
  report.ok(`papers: ${papers.length}`);
  report.ok(`rows upserted: ${rows}`);
}

main().catch((err) => {
  console.error("\ningest:upsc-syllabus failed:", err instanceof Error ? err.stack : err);
  process.exit(1);
});
