/**
 * Study-notes generation orchestrator.
 *
 *   1. Load context: node, subtree weightage (Session-12 mv_node_weightage),
 *      the node's PYQs+explanations, linked current affairs, and RAG grounding.
 *   2. Research (optional): web_search for CURRENT UP-specific facts + sources.
 *   3. Author: one structured bilingual note + SRS candidates (claude-sonnet-5).
 *   4. Critic: factual red flags + syllabus drift (recorded, not gating).
 *   5. Persist to `notes` as status='needs_review' → the Review Queue Notes tab.
 *
 * Mirrors apps/api/src/qgen/generate.ts. Cost is aggregated across all three
 * model calls via onUsage and stored on the row.
 */
import type { LlmUsage } from "../lib/anthropic.js";
import { structuredJson, webResearch } from "../lib/anthropic.js";
import { supabase } from "../lib/supabase.js";
import { retrieveGrounding } from "../services/evaluation/grounding.js";
import { loadNodeWeightage, lastAskedYear } from "../lib/weightage.js";
import {
  NOTES_PROMPT_VERSION,
  RESEARCH_SYSTEM_PROMPT,
  buildResearchContent,
  buildNoteGenParams,
  parseNoteGen,
  buildNoteCriticParams,
  parseNoteCritic,
  type NoteNodeContext,
  type NotePyq,
  type NoteCaItem,
  type WeightageSnapshot,
} from "./prompts.js";
import type { NoteContentI18n, NoteCriticVerdict, NoteSource, NoteSrsCandidate } from "@prayasup/shared";

export type Log = (msg: string) => void;

export interface NoteNodeRow {
  id: string;
  paper_code: string;
  exam_stage: "prelims" | "mains";
  path: string;
  title_i18n: { hi: string; en: string };
  description_i18n: { hi: string; en: string } | null;
}

export interface GenerateNoteResult {
  noteId: string | null;
  nodeId: string;
  nodeTitle: string;
  status: "needs_review" | "skipped";
  webSearchUsed: boolean;
  critic: NoteCriticVerdict | null;
  costUsd: number;
  keyFactCount: number;
  srsCandidateCount: number;
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------
export async function loadNoteNode(nodeId: string): Promise<NoteNodeRow> {
  const { data, error } = await supabase()
    .from("syllabus_nodes")
    .select("id, paper_code, exam_stage, path, title_i18n, description_i18n")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) throw new Error(`syllabus node lookup failed: ${error.message}`);
  if (!data) throw new Error(`syllabus node ${nodeId} not found`);
  return data as NoteNodeRow;
}

function toNodeContext(row: NoteNodeRow): NoteNodeContext {
  return {
    id: row.id,
    paperCode: row.paper_code,
    stage: row.exam_stage,
    title_i18n: row.title_i18n,
    description_i18n: row.description_i18n,
  };
}

/** Roll the node's OWN + descendant PYQ weightage up through its subtree. */
async function loadWeightageSnapshot(row: NoteNodeRow): Promise<{ snapshot: WeightageSnapshot; nodeIds: string[] }> {
  // Descendants share the paper and have a path prefixed by this node's path.
  const { data: descs } = await supabase()
    .from("syllabus_nodes")
    .select("id, path")
    .eq("paper_code", row.paper_code);
  const prefix = row.path ? `${row.path}/` : "";
  const nodeIds = (descs ?? [])
    .filter((d) => {
      const p = (d as { path: string }).path;
      // The node itself, plus anything under it (root path '' matches all).
      return p === row.path || (prefix ? p.startsWith(prefix) : true);
    })
    .map((d) => (d as { id: string }).id);
  const idSet = new Set(nodeIds);

  const weightMap = await loadNodeWeightage();
  const byYear: Record<string, number> = {};
  let total = 0;
  const merged = new Map<number, number>();
  for (const [id, w] of weightMap) {
    if (!idSet.has(id)) continue;
    for (const [year, count] of w.byYear) {
      merged.set(year, (merged.get(year) ?? 0) + count);
      total += count;
    }
  }
  for (const [year, count] of merged) byYear[String(year)] = count;
  return {
    snapshot: { totalPyqs: total, byYear, lastAskedYear: lastAskedYear(merged) },
    nodeIds,
  };
}

/** Up to 10 published PYQs (with explanations) across the node's subtree. */
async function loadNotePyqs(nodeIds: string[]): Promise<NotePyq[]> {
  if (nodeIds.length === 0) return [];
  const { data } = await supabase()
    .from("questions")
    .select("stem_i18n, explanation_i18n, year")
    .in("syllabus_node_id", nodeIds)
    .eq("is_published", true)
    .order("year", { ascending: false })
    .limit(10);
  return ((data ?? []) as {
    stem_i18n: { en?: string };
    explanation_i18n: { en?: string } | null;
    year: number | null;
  }[]).map((q) => ({
    year: q.year,
    stem_en: q.stem_i18n?.en ?? "",
    explanation_en: q.explanation_i18n?.en ?? null,
  }));
}

/** Up to 8 published current-affairs items linked to this node. */
async function loadNoteCa(nodeId: string): Promise<NoteCaItem[]> {
  const { data } = await supabase()
    .from("current_affairs_items")
    .select("title_i18n, summary_i18n, source_urls")
    .contains("syllabus_node_ids", [nodeId])
    .eq("is_published", true)
    .order("date", { ascending: false })
    .limit(8);
  return ((data ?? []) as {
    title_i18n: { en?: string };
    summary_i18n: { en?: string } | null;
    source_urls: string[] | null;
  }[]).map((c) => ({
    title_en: c.title_i18n?.en ?? "",
    summary_en: c.summary_i18n?.en ?? null,
    url: c.source_urls?.[0] ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Generate one note
// ---------------------------------------------------------------------------
export async function generateNoteForNode(
  nodeId: string,
  opts: { web?: boolean } = {},
  log: Log = () => {},
): Promise<GenerateNoteResult> {
  const useWeb = opts.web !== false;
  const row = await loadNoteNode(nodeId);
  const node = toNodeContext(row);
  log(`  loading context for "${node.title_i18n.en}" (${node.paperCode})…`);

  const [{ snapshot, nodeIds }, ca] = await Promise.all([loadWeightageSnapshot(row), loadNoteCa(nodeId)]);
  const query = `${node.title_i18n.en}. ${node.description_i18n?.en ?? ""}`.trim();
  const [pyqs, grounding] = await Promise.all([
    loadNotePyqs(nodeIds),
    retrieveGrounding({ questionText: query, locale: "en", syllabusNodeId: node.id, k: 8 }),
  ]);

  let costUsd = 0;
  const onUsage = (u: LlmUsage) => {
    costUsd += u.costUsd;
  };

  // Stage 1 — research (optional, graceful).
  let research = "";
  let sources: NoteSource[] = [];
  let webSearchUsed = false;
  if (useWeb) {
    log("  researching current facts via web_search…");
    const r = await webResearch({
      system: RESEARCH_SYSTEM_PROMPT,
      content: buildResearchContent(node),
      maxUses: 5,
      purpose: "notes_research",
      onUsage,
    });
    research = r.text;
    sources = r.sources.map((s) => ({ id: s.id, title: s.title, url: s.url }));
    webSearchUsed = sources.length > 0 || research.length > 0;
    log(`  web research: ${sources.length} source(s), ${research.length} chars`);
  }

  // Stage 2 — author the note.
  log("  authoring bilingual note…");
  const genJson = await structuredJson({
    ...buildNoteGenParams({ node, pyqs, weightage: snapshot, ca, grounding, research, sources }),
    purpose: "notes_generate",
    onUsage,
  });
  const { content, srs_candidates } = parseNoteGen(genJson);

  // Stage 3 — critic (records verdict; humans still review).
  log("  running critic…");
  let critic: NoteCriticVerdict | null = null;
  try {
    const criticJson = await structuredJson({
      ...buildNoteCriticParams({ node, content }),
      purpose: "notes_critic",
      onUsage,
    });
    critic = parseNoteCritic(criticJson);
  } catch (err) {
    log(`  critic failed (non-fatal): ${(err as Error).message}`);
  }

  const noteId = await persistNote({
    nodeId,
    content,
    sources,
    srsCandidates: srs_candidates,
    snapshot,
    critic,
    webSearchUsed,
    sourceContextIds: nodeIds,
    costUsd,
  });

  log(`  ✓ note ${noteId} → needs_review ($${costUsd.toFixed(4)})`);
  return {
    noteId,
    nodeId,
    nodeTitle: node.title_i18n.en,
    status: "needs_review",
    webSearchUsed,
    critic,
    costUsd,
    keyFactCount: content.en.key_facts.length,
    srsCandidateCount: srs_candidates.length,
  };
}

// ---------------------------------------------------------------------------
// Persist (upsert on the unique syllabus_node_id; bumps version)
// ---------------------------------------------------------------------------
async function persistNote(opts: {
  nodeId: string;
  content: NoteContentI18n;
  sources: NoteSource[];
  srsCandidates: NoteSrsCandidate[];
  snapshot: WeightageSnapshot;
  critic: NoteCriticVerdict | null;
  webSearchUsed: boolean;
  sourceContextIds: string[];
  costUsd: number;
}): Promise<string> {
  const { data: existing } = await supabase()
    .from("notes")
    .select("id, version")
    .eq("syllabus_node_id", opts.nodeId)
    .maybeSingle();
  const version = existing ? ((existing as { version: number }).version ?? 0) + 1 : 1;

  const rows = {
    syllabus_node_id: opts.nodeId,
    content_i18n: opts.content,
    sources: opts.sources,
    srs_candidates: opts.srsCandidates,
    status: "needs_review" as const,
    version,
    model: "claude-sonnet-5",
    cost_usd: opts.costUsd,
    meta: {
      prompt_version: NOTES_PROMPT_VERSION,
      web_search_used: opts.webSearchUsed,
      critic: opts.critic,
      weightage_snapshot: {
        total_pyqs: opts.snapshot.totalPyqs,
        top_years: Object.keys(opts.snapshot.byYear).map(Number).sort((a, b) => b - a).slice(0, 5),
      },
      source_context_ids: opts.sourceContextIds,
    },
  };

  const { data, error } = await supabase()
    .from("notes")
    .upsert(rows, { onConflict: "syllabus_node_id" })
    .select("id")
    .single();
  if (error) throw new Error(`note upsert failed: ${error.message}`);
  const noteId = (data as { id: string }).id;

  // The note is now needs_review with fresh content; drop any embeddings from a
  // previously published version so RAG never serves stale note text until
  // notes:embed re-runs after re-publish. Best-effort.
  if (existing) {
    const { error: delErr } = await supabase()
      .from("embeddings")
      .delete()
      .eq("source_type", "note")
      .eq("source_id", noteId);
    if (delErr) console.warn(`  (warn) failed to clear stale note embeddings: ${delErr.message}`);
  }
  return noteId;
}

// ---------------------------------------------------------------------------
// Top-weightage node picker (for --paper --top N)
// ---------------------------------------------------------------------------
/** Which of the given node ids already have a note (any status) — for gap-fill runs. */
export async function existingNoteNodeIds(nodeIds: string[]): Promise<Set<string>> {
  if (nodeIds.length === 0) return new Set();
  const { data } = await supabase().from("notes").select("syllabus_node_id").in("syllabus_node_id", nodeIds);
  return new Set(((data ?? []) as { syllabus_node_id: string }[]).map((r) => r.syllabus_node_id));
}

export async function resolvePaperCode(paperArg: string): Promise<string> {
  const { data } = await supabase()
    .from("syllabus_nodes")
    .select("paper_code")
    .eq("paper_code", paperArg)
    .eq("depth", 0)
    .maybeSingle();
  if (data) return paperArg;
  const { data: all } = await supabase().from("syllabus_nodes").select("paper_code").eq("depth", 0);
  const codes = [...new Set((all ?? []).map((r) => (r as { paper_code: string }).paper_code))];
  throw new Error(`unknown paper "${paperArg}". Valid: ${codes.join(", ")}`);
}

/** Top-N depth>=1 nodes of a paper by rolled-up PYQ weightage (Session-12 data). */
export async function topWeightageNodes(paperCode: string, n: number): Promise<{ id: string; title: string; total: number }[]> {
  const { data: nodes } = await supabase()
    .from("syllabus_nodes")
    .select("id, path, depth, title_i18n")
    .eq("paper_code", paperCode);
  const rows = (nodes ?? []) as { id: string; path: string; depth: number; title_i18n: { en: string } }[];
  const weightMap = await loadNodeWeightage();

  // Roll each node's subtree total (own + descendants).
  const scored = rows
    .filter((r) => r.depth >= 1)
    .map((r) => {
      const prefix = r.path ? `${r.path}/` : "";
      let total = 0;
      for (const d of rows) {
        if (d.path === r.path || (prefix && d.path.startsWith(prefix))) {
          total += weightMap.get(d.id)?.total ?? 0;
        }
      }
      return { id: r.id, title: r.title_i18n.en, total };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);

  return scored.slice(0, n);
}
