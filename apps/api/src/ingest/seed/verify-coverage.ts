/**
 * Coverage verifier for the hand-authored UPSC syllabus tree.
 *
 * PURE: no DB, no network, no filesystem, no model call, no clock, no randomness.
 * `verifyCoverage(lines, tree)` is a deterministic function of its two inputs,
 * so it is trivially testable and its result can be rendered to a report or a
 * markdown artifact without re-running anything.
 *
 * It answers the two questions the hand-authored tree exists to guarantee:
 *   NOTHING MISSED    — every verbatim official line is claimed by >=1 node.
 *   NOTHING INVENTED  — every node covers >=1 real line somewhere in its subtree.
 * plus structural, bilingual and referential integrity.
 */
import type { OfficialSyllabusLine, SeedNode } from "./upsc-syllabus-types.js";

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

/**
 * `defect` blocks the write. `info` never does — it is a legitimate-but-notable
 * observation the report must surface rather than swallow.
 */
export type IssueSeverity = "defect" | "info";

export type IssueKind =
  // --- DEFECTS -------------------------------------------------------------
  /** An official line claimed by ZERO nodes. The "nothing missed" gate. */
  | "unmapped_official_line"
  /** A node whose EFFECTIVE line set (own ∪ all descendants') is empty. */
  | "invented_topic"
  /** A node claims a line id that does not exist in UPSC_OFFICIAL_LINES. */
  | "dangling_line_reference"
  /** A node claims a line whose paperCode differs from the node's. */
  | "cross_paper_reference"
  /** Two nodes share the same (paperCode, path) — the upsert conflict key. */
  | "duplicate_node_path"
  /** A node's parent path is absent from the tree, so parent_id cannot resolve. */
  | "missing_parent_path"
  /** Leading/trailing/double slash, empty path, or a non-kebab-case segment. */
  | "malformed_path"
  /** paperCode is not one of the known UPSC paper codes. */
  | "unknown_paper_code"
  /** Blank title.en/title.hi, or a half-filled description object. */
  | "bilingual_incomplete"
  /** The same line id appears twice in UPSC_OFFICIAL_LINES. */
  | "duplicate_official_line_id"
  /** derivation === "editorial_subdivision" with no `subdivisionRationale`. */
  | "missing_subdivision_rationale"
  /** derivation === "official_line" but the node names no official line of its own. */
  | "official_line_without_own_line"
  /** depth > MAX_NODE_DEPTH — breaks grain comparability with the UPPSC tree. */
  | "excessive_depth"
  // --- INFO ----------------------------------------------------------------
  /** One official line legitimately spanning several nodes. */
  | "line_mapped_to_multiple_nodes"
  /** An authored `ambiguityNote` — surfaced, never resolved. */
  | "ambiguity_note"
  /** A declared editorial subdivision — surfaced for reviewer audit, never a defect. */
  | "editorial_subdivision";

export interface CoverageIssue {
  kind: IssueKind;
  severity: IssueSeverity;
  /** Paper the issue belongs to, or null when it cannot be attributed to one. */
  paperCode: string | null;
  /** The node path or official line id the issue is about. */
  subject: string;
  message: string;
}

export interface PaperStats {
  paperCode: string;
  /** Authored nodes (the implicit paper root is NOT counted). */
  nodes: number;
  /** Nodes with no children in the authored tree. */
  leaves: number;
  maxDepth: number;
  /** Top-level sections. Part of the "did we match UPPSC's grain?" shape summary. */
  depth1: number;
  /** Depth-2 nodes. The UPPSC tree bottoms out here in all 10 papers. */
  depth2: number;
  /** Official lines belonging to this paper. */
  lines: number;
  /** …of which claimed by >=1 node. */
  linesCovered: number;
  /** depth -> node count. */
  depthDistribution: Record<number, number>;
  /** Nodes whose scope IS official text. */
  officialLineNodes: number;
  /** Nodes declared as conventional subdivisions of an official line's scope. */
  editorialSubdivisionNodes: number;
}

/** One declared editorial subdivision, for the audit table. */
export interface EditorialSubdivision {
  paperCode: string;
  path: string;
  titleEn: string;
  /** The official line ids whose scope this node refines (own ∪ descendants'). */
  refines: string[];
  rationale: string;
}

export interface CoverageResult {
  /** True iff there are zero defects. Info issues never affect this. */
  ok: boolean;
  defects: CoverageIssue[];
  infos: CoverageIssue[];
  perPaper: PaperStats[];
  totals: {
    papers: number;
    nodes: number;
    leaves: number;
    lines: number;
    linesCovered: number;
    linesUnmapped: number;
    officialLineNodes: number;
    editorialSubdivisionNodes: number;
    defects: number;
    infos: number;
  };
  /**
   * Every node declared `editorial_subdivision`, i.e. every node whose title is
   * NOT literal official text. This list IS the auditable answer to "no
   * invented topics" — render it prominently, never bury it.
   */
  editorialSubdivisions: EditorialSubdivision[];
  /** line id -> node paths that DIRECTLY claim it (`${paperCode}:${path}`). */
  lineToNodes: Map<string, string[]>;
  /** `${paperCode}:${path}` -> that node's own + effective (subtree) line ids. */
  nodeToLines: Map<string, { own: string[]; effective: string[] }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable key matching the DB upsert conflict target (paper_code, path). */
export function nodeKey(paperCode: string, path: string): string {
  return `${paperCode}:${path}`;
}

/** depth = number of `/`-separated segments; a top-level section is depth 1. */
export function depthOf(path: string): number {
  return path.split("/").length;
}

/** Parent path of a node path; `""` (the implicit paper root) for a top-level node. */
export function parentPathOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

const KEBAB_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Hard depth ceiling. The UPPSC tree is max-depth-2 in ALL 10 papers with zero
 * exceptions, and the weightage rollup, qgen targeting and chapter rollout all
 * reason about d1-sections/d2-topics. A depth-3 node in a second exam's tree
 * would break that grain comparability, so it is a defect rather than a style
 * preference.
 */
export const MAX_NODE_DEPTH = 2;

function blank(s: string | null | undefined): boolean {
  return !s || !s.trim();
}

// ---------------------------------------------------------------------------
// verifyCoverage
// ---------------------------------------------------------------------------
export function verifyCoverage(
  lines: readonly OfficialSyllabusLine[],
  tree: readonly SeedNode[],
  /** The legal paper codes. Defaults to the 7 UPSC papers via the caller. */
  knownPaperCodes: readonly string[] = [],
): CoverageResult {
  const defects: CoverageIssue[] = [];
  const infos: CoverageIssue[] = [];
  const known = new Set(knownPaperCodes);

  const defect = (kind: IssueKind, paperCode: string | null, subject: string, message: string) =>
    defects.push({ kind, severity: "defect", paperCode, subject, message });
  const info = (kind: IssueKind, paperCode: string | null, subject: string, message: string) =>
    infos.push({ kind, severity: "info", paperCode, subject, message });

  // --- 7. Duplicate official line ids -------------------------------------
  const lineById = new Map<string, OfficialSyllabusLine>();
  for (const l of lines) {
    if (lineById.has(l.id)) {
      defect(
        "duplicate_official_line_id",
        l.paperCode,
        l.id,
        `official line id "${l.id}" appears more than once in UPSC_OFFICIAL_LINES`,
      );
      continue; // first occurrence wins for every downstream check
    }
    lineById.set(l.id, l);
  }

  // --- 5a. Duplicate (paperCode, path) + unknown paper code + malformed path
  const byKey = new Map<string, SeedNode>();
  for (const n of tree) {
    if (known.size > 0 && !known.has(n.paperCode)) {
      defect(
        "unknown_paper_code",
        n.paperCode,
        n.path,
        `paperCode "${n.paperCode}" is not a known UPSC paper code`,
      );
    }

    const path = n.path;
    const pathProblems: string[] = [];
    if (blank(path)) {
      pathProblems.push("path is empty — the paper root is implicit and must never be authored");
    } else {
      if (path !== path.trim()) pathProblems.push("path has leading/trailing whitespace");
      if (path.startsWith("/")) pathProblems.push("leading slash");
      if (path.endsWith("/")) pathProblems.push("trailing slash");
      if (path.includes("//")) pathProblems.push("double slash");
      for (const seg of path.split("/")) {
        if (!KEBAB_SEGMENT.test(seg)) pathProblems.push(`segment "${seg}" is not lowercase kebab-case`);
      }
    }
    if (pathProblems.length > 0) {
      defect("malformed_path", n.paperCode, path, pathProblems.join("; "));
    }

    // --- Grain: depth ceiling --------------------------------------------
    if (!blank(path) && depthOf(path) > MAX_NODE_DEPTH) {
      defect(
        "excessive_depth",
        n.paperCode,
        path,
        `depth ${depthOf(path)} exceeds the max of ${MAX_NODE_DEPTH} — the UPPSC tree bottoms out at depth 2 in all 10 papers, ` +
          "and weightage/qgen/chapter targeting reason about d1 sections and d2 topics",
      );
    }

    const key = nodeKey(n.paperCode, path);
    if (byKey.has(key)) {
      defect(
        "duplicate_node_path",
        n.paperCode,
        path,
        `(paper_code, path) is the DB upsert conflict key — "${key}" is authored twice, so one node would silently overwrite the other`,
      );
      continue; // first occurrence wins
    }
    byKey.set(key, n);

    // --- 6. Bilingual completeness ---------------------------------------
    const missingTitle = [blank(n.title?.en) ? "title.en" : null, blank(n.title?.hi) ? "title.hi" : null].filter(
      (x): x is string => x !== null,
    );
    if (missingTitle.length > 0) {
      defect(
        "bilingual_incomplete",
        n.paperCode,
        path,
        `blank ${missingTitle.join(" + ")} — both languages are required (bilingual publish gate)`,
      );
    }
    if (n.description !== null && n.description !== undefined) {
      const missingDesc = [
        blank(n.description.en) ? "description.en" : null,
        blank(n.description.hi) ? "description.hi" : null,
      ].filter((x): x is string => x !== null);
      if (missingDesc.length > 0) {
        defect(
          "bilingual_incomplete",
          n.paperCode,
          path,
          `half-filled description: blank ${missingDesc.join(" + ")} — use null for "no description", never one language only`,
        );
      }
    }

    // --- 9. Derivation declaration ---------------------------------------
    // "No invented topics" cannot mean "every title is a literal official
    // phrase" (UPSC Prelims has 7 official bullets vs the 31-node grain we
    // mirror), so it means: trace to official text AND declare accurately.
    if (n.derivation === "editorial_subdivision") {
      if (blank(n.subdivisionRationale)) {
        defect(
          "missing_subdivision_rationale",
          n.paperCode,
          path,
          "declared editorial_subdivision but gave no subdivisionRationale — a non-official title must justify " +
            "why it is a faithful decomposition of the official line's scope and not an addition to it",
        );
      }
    } else if (n.derivation === "official_line") {
      if ((n.officialLines ?? []).length === 0) {
        defect(
          "official_line_without_own_line",
          n.paperCode,
          path,
          "declared official_line (i.e. its scope IS official text) but names no officialLines of its own — " +
            'say WHICH line, or declare it "editorial_subdivision" with a rationale',
        );
      }
    }

    // --- 8b. Ambiguity notes (INFO) --------------------------------------
    if (n.ambiguityNote && n.ambiguityNote.trim()) {
      info("ambiguity_note", n.paperCode, path, n.ambiguityNote.trim());
    }
  }

  const nodes = [...byKey.values()];

  // --- 5b. Missing parent path -------------------------------------------
  for (const n of nodes) {
    const parent = parentPathOf(n.path);
    if (parent === "") continue; // implicit paper root, always present
    if (!byKey.has(nodeKey(n.paperCode, parent))) {
      defect(
        "missing_parent_path",
        n.paperCode,
        n.path,
        `parent path "${parent}" is not authored in this paper — parent_id could not resolve at load`,
      );
    }
  }

  // --- 3 + 4. Line references: dangling + cross-paper ---------------------
  // `own` keeps only references that are valid AND in-paper, so a bad reference
  // can never make an invented topic look covered.
  const ownLines = new Map<string, string[]>();
  const lineToNodes = new Map<string, string[]>();
  for (const n of nodes) {
    const key = nodeKey(n.paperCode, n.path);
    const valid: string[] = [];
    for (const id of new Set(n.officialLines ?? [])) {
      const line = lineById.get(id);
      if (!line) {
        defect(
          "dangling_line_reference",
          n.paperCode,
          n.path,
          `claims official line "${id}", which does not exist in UPSC_OFFICIAL_LINES`,
        );
        continue;
      }
      if (line.paperCode !== n.paperCode) {
        defect(
          "cross_paper_reference",
          n.paperCode,
          n.path,
          `claims official line "${id}", which belongs to paper "${line.paperCode}"`,
        );
        continue;
      }
      valid.push(id);
      const claimants = lineToNodes.get(id) ?? [];
      claimants.push(key);
      lineToNodes.set(id, claimants);
    }
    ownLines.set(key, valid.sort());
  }

  // --- 2. Effective line set (own ∪ every descendant's own) --------------
  // Prefix-based descendant test rather than a parent->child walk: it stays
  // correct even when the parent chain is broken (a `missing_parent_path`
  // defect), so one structural defect cannot cascade into phantom
  // `invented_topic` reports for every node beneath it.
  const nodeToLines = new Map<string, { own: string[]; effective: string[] }>();
  for (const n of nodes) {
    const key = nodeKey(n.paperCode, n.path);
    const eff = new Set(ownLines.get(key) ?? []);
    const prefix = `${n.path}/`;
    for (const m of nodes) {
      if (m.paperCode !== n.paperCode) continue;
      if (!m.path.startsWith(prefix)) continue;
      for (const id of ownLines.get(nodeKey(m.paperCode, m.path)) ?? []) eff.add(id);
    }
    const effective = [...eff].sort();
    nodeToLines.set(key, { own: ownLines.get(key) ?? [], effective });
    if (effective.length === 0) {
      defect(
        "invented_topic",
        n.paperCode,
        n.path,
        "covers no official syllabus line anywhere in its subtree — either map it to real official text or delete it",
      );
    }
  }

  // --- 9b. Editorial-subdivision audit list (INFO) -----------------------
  // Built AFTER the effective sets, so `refines` names the official lines the
  // subdivision actually traces to rather than only its own direct claims.
  const editorialSubdivisions: EditorialSubdivision[] = [];
  for (const n of nodes) {
    if (n.derivation !== "editorial_subdivision") continue;
    const key = nodeKey(n.paperCode, n.path);
    const refines = nodeToLines.get(key)?.effective ?? [];
    editorialSubdivisions.push({
      paperCode: n.paperCode,
      path: n.path,
      titleEn: n.title?.en ?? "",
      refines,
      rationale: (n.subdivisionRationale ?? "").trim(),
    });
    info(
      "editorial_subdivision",
      n.paperCode,
      n.path,
      `"${n.title?.en ?? ""}" is NOT literal official text — refines ${refines.length ? refines.join(", ") : "(none)"}: ` +
        ((n.subdivisionRationale ?? "").trim() || "(no rationale — see defect)"),
    );
  }

  // --- 1. Unmapped official lines + 8a. multi-node lines (INFO) ----------
  for (const l of lineById.values()) {
    const claimants = lineToNodes.get(l.id) ?? [];
    if (claimants.length === 0) {
      defect(
        "unmapped_official_line",
        l.paperCode,
        l.id,
        `no node covers this official line — "${truncate(l.text)}" (${l.source})`,
      );
    } else if (claimants.length > 1) {
      info(
        "line_mapped_to_multiple_nodes",
        l.paperCode,
        l.id,
        `legitimately spans ${claimants.length} nodes: ${claimants.map((c) => c.split(":")[1]).join(", ")}`,
      );
    }
  }

  // --- Per-paper stats ----------------------------------------------------
  // Every paper that has EITHER nodes or official lines, so a paper with lines
  // but no tree (or a tree but no lines) still gets a row in the report.
  const paperCodes = [
    ...new Set([...nodes.map((n) => n.paperCode), ...[...lineById.values()].map((l) => l.paperCode)]),
  ].sort();

  const perPaper: PaperStats[] = paperCodes.map((paperCode) => {
    const paperNodes = nodes.filter((n) => n.paperCode === paperCode);
    const paperLines = [...lineById.values()].filter((l) => l.paperCode === paperCode);
    const depthDistribution: Record<number, number> = {};
    let maxDepth = 0;
    let leaves = 0;
    for (const n of paperNodes) {
      const d = depthOf(n.path);
      depthDistribution[d] = (depthDistribution[d] ?? 0) + 1;
      if (d > maxDepth) maxDepth = d;
      const prefix = `${n.path}/`;
      if (!paperNodes.some((m) => m.path.startsWith(prefix))) leaves++;
    }
    return {
      paperCode,
      nodes: paperNodes.length,
      leaves,
      maxDepth,
      depth1: depthDistribution[1] ?? 0,
      depth2: depthDistribution[2] ?? 0,
      lines: paperLines.length,
      linesCovered: paperLines.filter((l) => (lineToNodes.get(l.id) ?? []).length > 0).length,
      depthDistribution,
      officialLineNodes: paperNodes.filter((n) => n.derivation === "official_line").length,
      editorialSubdivisionNodes: paperNodes.filter((n) => n.derivation === "editorial_subdivision").length,
    };
  });

  const totals = {
    papers: perPaper.length,
    nodes: nodes.length,
    leaves: perPaper.reduce((a, p) => a + p.leaves, 0),
    lines: lineById.size,
    linesCovered: perPaper.reduce((a, p) => a + p.linesCovered, 0),
    linesUnmapped: defects.filter((d) => d.kind === "unmapped_official_line").length,
    officialLineNodes: perPaper.reduce((a, p) => a + p.officialLineNodes, 0),
    editorialSubdivisionNodes: perPaper.reduce((a, p) => a + p.editorialSubdivisionNodes, 0),
    defects: defects.length,
    infos: infos.length,
  };

  return {
    ok: defects.length === 0,
    defects,
    infos,
    perPaper,
    totals,
    lineToNodes,
    nodeToLines,
    editorialSubdivisions,
  };
}

function truncate(s: string, max = 120): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}
