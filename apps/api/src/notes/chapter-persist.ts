/**
 * Shared persistence + derivation for study CHAPTERS (Session 28), used by BOTH
 * the real-API multi-pass generator (chapter-generate.ts) and the agent-JSON
 * assemble bridge (chapter-assemble.ts) — the same way ingest:pyq:load and
 * ingest:assemble share one loader.
 *
 * A chapter upgrades a note in place:
 *   - study_content_i18n  ← the sections (this pass)
 *   - fact_audit          ← the decisive-fact verification report (this pass)
 *   - chapter_version     ← bumped
 *   - content_i18n        ← the EXISTING digest is preserved untouched (it is the
 *                           Quick Revision layer); only synthesised for a node
 *                           that had no note yet, so the publish gate can pass.
 *   - sources             ← existing ∪ new web sources
 * Status resets to needs_review so a regenerated chapter re-enters the queue.
 */
import type {
  AuditedFact,
  ChapterSection,
  FactAudit,
  FactAuditSummary,
  NoteBody,
  NoteContentI18n,
  NoteSource,
  NoteSrsCandidate,
  StudyContent,
} from "@neev/shared";
import { supabase } from "../lib/supabase.js";

/** Avg words/minute for dense exam prose — deliberately conservative. */
const WORDS_PER_MINUTE = 200;

/** Build the full StudyContent payload (toc + counts) from the authored sections. */
export function buildStudyContent(sections: ChapterSection[]): StudyContent {
  const toc = sections.map((s) => ({ id: s.id, heading_i18n: s.heading_i18n }));
  const text = sections
    .map((s) => `${s.body_md_i18n.en} ${s.boxes.map((b) => b.content_i18n.en).join(" ")}`)
    .join(" ");
  const wordCount = (text.match(/\S+/g) ?? []).length;
  return {
    sections,
    toc,
    est_read_minutes: Math.max(1, Math.round(wordCount / WORDS_PER_MINUTE)),
    word_count: wordCount,
  };
}

export function summarizeFactAudit(facts: AuditedFact[]): FactAuditSummary {
  return {
    verified: facts.filter((f) => f.status === "verified").length,
    flagged: facts.filter((f) => f.status === "flagged").length,
    unverifiable: facts.filter((f) => f.status === "unverifiable").length,
  };
}

/**
 * The chapter's own sources become the note's `sources` — the chapter is the
 * primary content and its facts/body cite these ids ([S#]), so they must resolve
 * against exactly this set. Merging with an existing digest's sources would
 * duplicate ids (both start at S1) and mis-resolve a [S#] ref. De-dupe within the
 * chapter set by id (keep first) so the registry has unique keys.
 */
function chapterSources(chapter: NoteSource[], existing: NoteSource[]): NoteSource[] {
  const base = chapter.length > 0 ? chapter : existing;
  const byId = new Map<string, NoteSource>();
  for (const s of base) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()];
}

const EMPTY_BODY = (overview: string, quickRevision: string[]): NoteBody => ({
  overview,
  key_facts: [],
  up_angle: "",
  pyq_analysis: "",
  mnemonics: [],
  quick_revision: quickRevision,
  further_reading: [],
});

export interface ChapterPersistInput {
  nodeId: string;
  sections: ChapterSection[];
  factAuditFacts: AuditedFact[];
  sources: NoteSource[];
  /** Digest overview — used only to synthesise content_i18n for a node with no prior note. */
  overviewI18n: { hi: string; en: string };
  quickRevisionI18n?: { hi: string[]; en: string[] };
  srsCandidates?: NoteSrsCandidate[];
  model: string;
  costUsd: number;
  meta: Record<string, unknown>;
}

export interface ChapterPersistResult {
  noteId: string;
  chapterVersion: number;
  sectionCount: number;
  factCount: number;
  factSummary: FactAuditSummary;
}

interface ExistingNoteRow {
  id: string;
  version: number;
  chapter_version: number | null;
  content_i18n: NoteContentI18n | null;
  sources: NoteSource[] | null;
  srs_candidates: NoteSrsCandidate[] | null;
  meta: Record<string, unknown> | null;
}

function overviewComplete(content: NoteContentI18n | null): boolean {
  return !!content?.hi?.overview?.trim() && !!content?.en?.overview?.trim();
}

/** Persist a chapter onto its node's note (upsert on syllabus_node_id). */
export async function persistChapter(input: ChapterPersistInput): Promise<ChapterPersistResult> {
  const { data: existingRaw } = await supabase()
    .from("notes")
    .select("id, version, chapter_version, content_i18n, sources, srs_candidates, meta")
    .eq("syllabus_node_id", input.nodeId)
    .maybeSingle();
  const existing = (existingRaw as ExistingNoteRow | null) ?? null;

  const studyContent = buildStudyContent(input.sections);
  const factAudit: FactAudit = {
    facts: input.factAuditFacts,
    summary: summarizeFactAudit(input.factAuditFacts),
    audited_at: new Date().toISOString(),
    model: input.model,
  };

  // Preserve the existing digest untouched (it IS the Quick Revision layer). Only
  // synthesise a digest when the node had no note, so the overview publish gate
  // can pass and the Quick Revision tab has something to show.
  const content_i18n: NoteContentI18n = overviewComplete(existing?.content_i18n ?? null)
    ? (existing!.content_i18n as NoteContentI18n)
    : {
        hi: EMPTY_BODY(input.overviewI18n.hi, input.quickRevisionI18n?.hi ?? []),
        en: EMPTY_BODY(input.overviewI18n.en, input.quickRevisionI18n?.en ?? []),
      };

  const sources = chapterSources(input.sources, existing?.sources ?? []);
  // Keep any existing SRS candidates unless this pass supplies its own.
  const srs_candidates =
    input.srsCandidates && input.srsCandidates.length > 0
      ? input.srsCandidates
      : existing?.srs_candidates ?? [];

  const chapterVersion = (existing?.chapter_version ?? 0) + 1;
  const version = (existing?.version ?? 0) + 1;

  const row = {
    syllabus_node_id: input.nodeId,
    content_i18n,
    study_content_i18n: studyContent,
    fact_audit: factAudit,
    sources,
    srs_candidates,
    status: "needs_review" as const,
    version,
    chapter_version: chapterVersion,
    model: input.model,
    cost_usd: input.costUsd,
    meta: {
      ...(existing?.meta ?? {}),
      ...input.meta,
      chapter: true,
    },
  };

  const { data, error } = await supabase()
    .from("notes")
    .upsert(row, { onConflict: "syllabus_node_id" })
    .select("id")
    .single();
  if (error) throw new Error(`chapter upsert failed: ${error.message}`);
  const noteId = (data as { id: string }).id;

  // The chapter is now needs_review with fresh content — drop stale RAG chunks so
  // retrieval never serves the previous version until notes:embed re-runs after
  // re-publish. Best-effort.
  const { error: delErr } = await supabase()
    .from("embeddings")
    .delete()
    .eq("source_type", "note")
    .eq("source_id", noteId);
  if (delErr) console.warn(`  (warn) failed to clear stale note embeddings: ${delErr.message}`);

  return {
    noteId,
    chapterVersion,
    sectionCount: input.sections.length,
    factCount: input.factAuditFacts.length,
    factSummary: factAudit.summary,
  };
}
