/**
 * Study-CHAPTER generation orchestrator (Session 28) — the real-Anthropic-API
 * path used by `notes:chapter` and the batch backfill. Multi-pass:
 *
 *   1. OUTLINE   — plan sections from the node + children + PYQ patterns/weightage.
 *   2. RESEARCH  — chapter-level web_search (shared, prompt-cached across sections).
 *   3. SECTION   — one grounded call per planned section (body, boxes, diagram,
 *                  decisive facts, real PYQ chips).
 *   4. COHERENCE — transitions, dedup, terminology (applied light-touch).
 *   5. FACT AUDIT— classify every decisive fact against context; escalate the
 *                  unverified ones with web_search (Session-27 pattern). Unresolved
 *                  flags block publish (services/notes.ts).
 *   6. TRANSLATE — English → Hindi per section (haiku), machine_translated flagged.
 *
 * Section authoring is English-only; the translate pass fills Hindi. Cost is
 * aggregated across every call and capped per chapter (NOTES_CHAPTER_MAX_USD).
 */
import type { LlmUsage } from "../lib/anthropic.js";
import { structuredJson, webResearch, translate, MODELS } from "../lib/anthropic.js";
import { supabase } from "../lib/supabase.js";
import { retrieveGrounding, type GroundingResult } from "../services/evaluation/grounding.js";
import { loadNodeWeightage, lastAskedYear } from "../lib/weightage.js";
import { loadNoteNode, type NoteNodeRow } from "./generate.js";
import {
  CHAPTER_PROMPT_VERSION,
  CHAPTER_RESEARCH_SYSTEM,
  FACT_ESCALATE_SYSTEM,
  buildOutlineParams,
  buildChapterResearchContent,
  buildSectionParams,
  buildCoherenceParams,
  buildAuditParams,
  chapterContextBlock,
  type ChapterNodeContext,
  type ChapterPyq,
  type ChapterWeightage,
  type OutlineResult,
  type SectionRaw,
  type CoherenceResult,
  type AuditClassification,
} from "./chapter-prompts.js";
import { persistChapter, type ChapterPersistResult } from "./chapter-persist.js";
import type { AuditedFact, ChapterBox, ChapterDiagram, ChapterSection, NoteSource } from "@neev/shared";

export type Log = (msg: string) => void;

/** Per-chapter spend ceiling — a runaway multi-pass run aborts rather than bill on. */
export const NOTES_CHAPTER_MAX_USD = Number(process.env.NOTES_CHAPTER_MAX_USD ?? "4");

export interface GenerateChapterResult extends ChapterPersistResult {
  nodeId: string;
  nodeTitle: string;
  costUsd: number;
  sectionPlan: { id: string; heading_en: string; focus: string }[];
  webSearchUsed: boolean;
}

// ---------------------------------------------------------------------------
// Context loading
// ---------------------------------------------------------------------------
async function loadChildTitles(row: NoteNodeRow): Promise<string[]> {
  const prefix = row.path ? `${row.path}/` : "";
  const { data } = await supabase()
    .from("syllabus_nodes")
    .select("path, title_i18n")
    .eq("paper_code", row.paper_code);
  return ((data ?? []) as { path: string; title_i18n: { en?: string } }[])
    .filter((d) => d.path !== row.path && (prefix ? d.path.startsWith(prefix) : true))
    .map((d) => d.title_i18n?.en ?? "")
    .filter(Boolean)
    .slice(0, 40);
}

async function loadWeightage(row: NoteNodeRow): Promise<{ w: ChapterWeightage; nodeIds: string[] }> {
  const { data: descs } = await supabase()
    .from("syllabus_nodes")
    .select("id, path")
    .eq("paper_code", row.paper_code);
  const prefix = row.path ? `${row.path}/` : "";
  const nodeIds = ((descs ?? []) as { id: string; path: string }[])
    .filter((d) => d.path === row.path || (prefix ? d.path.startsWith(prefix) : true))
    .map((d) => d.id);
  const idSet = new Set(nodeIds);
  const weightMap = await loadNodeWeightage();
  const merged = new Map<number, number>();
  let total = 0;
  for (const [id, wt] of weightMap) {
    if (!idSet.has(id)) continue;
    for (const [year, count] of wt.byYear) {
      merged.set(year, (merged.get(year) ?? 0) + count);
      total += count;
    }
  }
  const byYear: Record<string, number> = {};
  for (const [year, count] of merged) byYear[String(year)] = count;
  return { w: { totalPyqs: total, byYear, lastAskedYear: lastAskedYear(merged) }, nodeIds };
}

async function loadPyqsWithIds(nodeIds: string[]): Promise<ChapterPyq[]> {
  if (nodeIds.length === 0) return [];
  const { data } = await supabase()
    .from("questions")
    .select("id, stem_i18n, explanation_i18n, year")
    .in("syllabus_node_id", nodeIds)
    .eq("is_published", true)
    .order("year", { ascending: false })
    .limit(14);
  return ((data ?? []) as {
    id: string;
    stem_i18n: { en?: string };
    explanation_i18n: { en?: string } | null;
    year: number | null;
  }[]).map((q, i) => ({
    n: i + 1,
    id: q.id,
    year: q.year,
    stem_en: q.stem_i18n?.en ?? "",
    explanation_en: q.explanation_i18n?.en ?? null,
  }));
}

function toNodeContext(row: NoteNodeRow, childTitles: string[]): ChapterNodeContext {
  return {
    id: row.id,
    paperCode: row.paper_code,
    stage: row.exam_stage,
    title_en: row.title_i18n.en,
    description_en: row.description_i18n?.en ?? null,
    childTitles,
  };
}

// ---------------------------------------------------------------------------
// Context loading (shared with the chapter-context CLI so agent-authored and
// API-authored chapters see byte-identical inputs).
// ---------------------------------------------------------------------------
export interface ChapterContext {
  node: ChapterNodeContext;
  weightage: ChapterWeightage;
  pyqs: ChapterPyq[];
  grounding: GroundingResult;
  nodeIds: string[];
}

export async function loadChapterContext(nodeId: string): Promise<ChapterContext> {
  const row = await loadNoteNode(nodeId);
  const [childTitles, { w: weightage, nodeIds }] = await Promise.all([loadChildTitles(row), loadWeightage(row)]);
  const node = toNodeContext(row, childTitles);
  const query = `${node.title_en}. ${node.description_en ?? ""}`.trim();
  const [pyqs, grounding] = await Promise.all([
    loadPyqsWithIds(nodeIds),
    retrieveGrounding({ questionText: query, locale: "en", syllabusNodeId: node.id, k: 10 }),
  ]);
  return { node, weightage, pyqs, grounding, nodeIds };
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
export async function generateChapterForNode(
  nodeId: string,
  opts: { web?: boolean } = {},
  log: Log = () => {},
): Promise<GenerateChapterResult> {
  const useWeb = opts.web !== false;
  const { node, weightage, pyqs, grounding, nodeIds } = await loadChapterContext(nodeId);
  log(`  loading context for "${node.title_en}" (${node.paperCode}) — ${weightage.totalPyqs} PYQs…`);

  let costUsd = 0;
  const onUsage = (u: LlmUsage) => {
    costUsd += u.costUsd;
  };
  const capCheck = (): void => {
    if (costUsd > NOTES_CHAPTER_MAX_USD) {
      throw new Error(`chapter exceeded NOTES_CHAPTER_MAX_USD ($${costUsd.toFixed(2)} > $${NOTES_CHAPTER_MAX_USD}); aborting`);
    }
  };

  // 1 — OUTLINE
  log("  [1/6] outline…");
  const outline = await structuredJson<OutlineResult>({
    ...buildOutlineParams({ node, weightage, pyqs }),
    purpose: "notes_chapter_outline",
    onUsage,
  });
  capCheck();
  log(`        planned ${outline.sections.length} section(s): ${outline.sections.map((s) => s.heading_en).join(" · ")}`);

  // 2 — RESEARCH (web, shared)
  let research = "";
  let sources: NoteSource[] = [];
  let webSearchUsed = false;
  if (useWeb) {
    log("  [2/6] web research…");
    const r = await webResearch({
      system: CHAPTER_RESEARCH_SYSTEM,
      content: buildChapterResearchContent(node),
      maxUses: 6,
      purpose: "notes_chapter_research",
      onUsage,
    });
    research = r.text;
    sources = r.sources.map((s) => ({ id: s.id, title: s.title, url: s.url }));
    webSearchUsed = sources.length > 0 || research.length > 0;
    log(`        ${sources.length} source(s), ${research.length} chars`);
    capCheck();
  }

  const context = chapterContextBlock({ node, weightage, grounding, research, sources, pyqs });
  const allHeadings = outline.sections.map((s) => s.heading_en);
  const pyqById = new Map(pyqs.map((p) => [p.n, p.id]));
  const resolvePyqIds = (refs: number[]): string[] =>
    [...new Set(refs.map((n) => pyqById.get(n)).filter((x): x is string => !!x))];

  // 3 — SECTION passes
  log(`  [3/6] writing ${outline.sections.length} sections…`);
  const rawSections: { id: string; heading_en: string; raw: SectionRaw }[] = [];
  for (const s of outline.sections) {
    const raw = await structuredJson<SectionRaw>({
      ...buildSectionParams({ context, section: s, allHeadings }),
      purpose: "notes_chapter_section",
      onUsage,
    });
    rawSections.push({ id: s.id, heading_en: s.heading_en, raw });
    capCheck();
  }

  // 4 — COHERENCE (light-touch apply: prepend transition openings)
  log("  [4/6] coherence…");
  let coherence: CoherenceResult | null = null;
  try {
    coherence = await structuredJson<CoherenceResult>({
      ...buildCoherenceParams(rawSections.map((s) => ({ id: s.id, heading_en: s.heading_en, body_md: s.raw.body_md }))),
      purpose: "notes_chapter_coherence",
      onUsage,
    });
    const transMap = new Map(coherence.transitions.map((t) => [t.section_id, t.opening_sentence_en]));
    for (const s of rawSections) {
      const opening = transMap.get(s.id);
      if (opening && opening.trim() && !s.raw.body_md.startsWith(opening.trim())) {
        s.raw.body_md = `${opening.trim()} ${s.raw.body_md}`;
      }
    }
  } catch (err) {
    log(`        coherence failed (non-fatal): ${(err as Error).message}`);
  }
  capCheck();

  // 5 — FACT AUDIT (classify → escalate unverified via web_search)
  log("  [5/6] fact audit…");
  const flatFacts: { index: number; section_id: string; claim: string; source_ref: string }[] = [];
  for (const s of rawSections) {
    for (const f of s.raw.decisive_facts) {
      flatFacts.push({ index: flatFacts.length, section_id: s.id, claim: f.claim, source_ref: f.source_ref });
    }
  }
  const auditedFacts: AuditedFact[] = [];
  if (flatFacts.length > 0) {
    const classified = await structuredJson<{ facts: AuditClassification[] }>({
      ...buildAuditParams({ facts: flatFacts.map((f) => ({ index: f.index, claim: f.claim })), context }),
      purpose: "notes_chapter_audit",
      onUsage,
    });
    capCheck();
    const byIndex = new Map(classified.facts.map((c) => [c.index, c]));
    for (const f of flatFacts) {
      const c = byIndex.get(f.index);
      let status: AuditedFact["status"] = c?.status ?? "unverifiable";
      let evidence = c?.evidence ?? "not classified";
      let sourceRef = (c?.source_ref && c.source_ref.trim()) || (f.source_ref.trim() || null);

      // Escalate anything not cleanly verified — web_search verification (Session 27).
      if (useWeb && status !== "verified" && costUsd < NOTES_CHAPTER_MAX_USD) {
        try {
          const esc = await webResearch({
            system: FACT_ESCALATE_SYSTEM,
            content: `Verify this decisive fact from a UPPSC study chapter:\n"${f.claim}"`,
            maxUses: 4,
            maxTokens: 2500,
            purpose: "notes_chapter_audit_escalate",
            onUsage,
          });
          const verdict = esc.text.match(/VERDICT:\s*(verified|flagged)/i)?.[1]?.toLowerCase();
          const evLine = esc.text.match(/EVIDENCE:\s*(.+)$/im)?.[1]?.trim();
          if (verdict === "verified") {
            status = "verified";
            evidence = evLine || "web-verified";
            if (esc.sources[0] && !sourceRef) {
              const sid = `S${sources.length + 1}`;
              sources.push({ id: sid, title: esc.sources[0].title, url: esc.sources[0].url });
              sourceRef = sid;
            }
          } else if (verdict === "flagged") {
            status = "flagged";
            evidence = evLine || "web-check contradicted the claim";
          }
        } catch {
          /* keep the pre-escalation status */
        }
      }
      auditedFacts.push({
        id: `f${f.index}`,
        section_id: f.section_id,
        claim: f.claim,
        status,
        source_ref: sourceRef,
        evidence,
        resolved: false,
      });
    }
  }
  const flagged = auditedFacts.filter((f) => f.status !== "verified").length;
  log(`        ${auditedFacts.length} decisive fact(s), ${flagged} needing review`);

  // 6 — TRANSLATE (English → Hindi, per section)
  log("  [6/6] translating to Hindi…");
  const tr = async (en: string): Promise<string> => (en.trim() ? await translate(en, "hi", "UPPSC study material") : "");
  const overviewHi = await tr(outline.overview_en);
  const sections: ChapterSection[] = [];
  for (const s of rawSections) {
    const outlineSec = outline.sections.find((o) => o.id === s.id)!;
    const headingHi = await tr(s.heading_en);
    const bodyHi = await tr(s.raw.body_md);
    const boxes: ChapterBox[] = [];
    for (const b of s.raw.boxes) {
      boxes.push({
        kind: b.kind,
        content_i18n: { en: b.content_md, hi: await tr(b.content_md) },
        pyq_ids: resolvePyqIds(b.pyq_refs),
      });
    }
    let diagram: ChapterDiagram | null = null;
    if (s.raw.diagram && s.raw.diagram.kind !== "none" && s.raw.diagram.source.trim()) {
      diagram = {
        kind: s.raw.diagram.kind,
        source_i18n: { en: s.raw.diagram.source, hi: await tr(s.raw.diagram.source) },
        caption_i18n: s.raw.diagram.caption.trim() ? { en: s.raw.diagram.caption, hi: await tr(s.raw.diagram.caption) } : null,
      };
    }
    sections.push({
      id: s.id,
      heading_i18n: { en: s.heading_en, hi: headingHi },
      body_md_i18n: { en: s.raw.body_md, hi: bodyHi },
      boxes,
      diagram,
      pyq_ids: resolvePyqIds([...s.raw.pyq_refs, ...outlineSec.planned_boxes.length ? [] : []]),
    });
  }

  const result = await persistChapter({
    nodeId,
    sections,
    factAuditFacts: auditedFacts,
    sources,
    overviewI18n: { en: outline.overview_en, hi: overviewHi },
    model: MODELS.sonnet,
    costUsd,
    meta: {
      prompt_version: CHAPTER_PROMPT_VERSION,
      web_search_used: webSearchUsed,
      machine_translated: true,
      section_plan: outline.sections.map((s) => ({ id: s.id, heading_en: s.heading_en, focus: s.focus })),
      coherence: coherence ? { terminology_fixes: coherence.terminology_fixes, duplicate_warnings: coherence.duplicate_warnings, overall: coherence.overall } : null,
      source_context_ids: nodeIds,
    },
  });

  log(`  ✓ chapter ${result.noteId} v${result.chapterVersion} → needs_review ($${costUsd.toFixed(4)})`);
  return {
    ...result,
    nodeId,
    nodeTitle: node.title_en,
    costUsd,
    sectionPlan: outline.sections.map((s) => ({ id: s.id, heading_en: s.heading_en, focus: s.focus })),
    webSearchUsed,
  };
}
