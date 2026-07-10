/**
 * Mentor RAG retrieval + citation resolution + the doubt-FAQ semantic cache.
 *
 * A doubt is embedded ONCE (in the answer's locale); that single vector drives
 * both (a) the FAQ-cache nearest-neighbour lookup and (b) the cross-content
 * retrieval over syllabus / questions / notes / current_affairs chunks. Retrieved
 * chunks are numbered [1..k] and resolved back to a human title + in-app deep
 * link so the answer can cite them inline and the UI can render citation chips.
 * Everything degrades gracefully: any embed/RPC failure yields empty grounding
 * (the mentor is told so and answers from general exam guidance, clearly labelled).
 */
import type { BilingualText, Locale, MentorCitation } from "@prayasup/shared";
import { supabase } from "../../lib/supabase.js";
import { embeddings } from "../../lib/embeddings.js";
import { logger } from "../../lib/logger.js";
import { normalizeQuestion } from "./normalize.js";

/** Cosine similarity below which we treat platform grounding as "not covered". */
export const WEAK_RETRIEVAL_THRESHOLD = 0.3;
/**
 * Two-tier FAQ-cache serving (Session 26.5):
 *  - >= SILENT: a near-identical doubt — serve the cached answer with no notice.
 *  - >= SIMILAR (but < SILENT): a related doubt — serve it WITH a "from a
 *    similar doubt" notice and a one-tap "Answer fresh".
 *  - < SIMILAR: a miss — generate.
 * SILENT also doubles as the dedup threshold on write: a fresh answer this close
 * to an existing same-mode entry UPDATES it ("newest wins") rather than adding a
 * near-duplicate row.
 */
export const FAQ_SILENT_THRESHOLD = 0.95;
export const FAQ_SIMILAR_THRESHOLD = 0.86;
/** How many candidates the lookup pulls so it can pick the best per-mode match. */
const FAQ_CANDIDATE_COUNT = 5;

const RETRIEVE_K = 6;

interface MatchRow {
  id: string;
  source_type: string;
  source_id: string;
  chunk_text: string;
  similarity: number;
}

export interface MentorContext {
  vectorLiteral: string | null;
  citations: MentorCitation[];
  /** Numbered context block for the model, "" when nothing was retrieved. */
  contextText: string;
  weak: boolean;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

export async function embedQuery(text: string): Promise<string | null> {
  // Normalize (strip courtesy filler, lowercase Latin, collapse whitespace) so
  // phrasing noise stops splitting one doubt into several cache clusters. The
  // same normalized vector drives BOTH the cache lookup and the cache write, so
  // they can never disagree.
  const query = normalizeQuestion(text);
  if (!query) return null;
  try {
    const [vec] = await embeddings().embed([query]);
    return vec ? toVectorLiteral(vec) : null;
  } catch (err) {
    logger.warn({ err }, "mentor: query embed failed");
    return null;
  }
}

async function matchEmbeddings(
  vectorLiteral: string,
  opts: { locale: Locale; matchCount: number; sourceType?: string; sourceId?: string },
): Promise<MatchRow[]> {
  const { data, error } = await supabase().rpc("match_embeddings", {
    query_embedding: vectorLiteral,
    match_count: opts.matchCount,
    filter_locale: opts.locale,
    filter_source_type: opts.sourceType ?? null,
    filter_source_id: opts.sourceId ?? null,
  });
  if (error) throw new Error(`match_embeddings failed: ${error.message}`);
  return (data ?? []) as MatchRow[];
}

/**
 * Resolve retrieved chunks (in retrieval order) to numbered citations with a
 * title and deep link, batching one lookup per source type.
 */
async function resolveCitations(chunks: MatchRow[]): Promise<MentorCitation[]> {
  const byType = new Map<string, Set<string>>();
  for (const c of chunks) {
    const set = byType.get(c.source_type) ?? new Set<string>();
    set.add(c.source_id);
    byType.set(c.source_type, set);
  }

  const titles = new Map<string, { title: BilingualText; link: string | null }>();
  const key = (t: string, id: string) => `${t}:${id}`;
  const truncate = (b: BilingualText): BilingualText => ({
    en: (b.en ?? "").slice(0, 140),
    hi: (b.hi ?? "").slice(0, 140),
  });

  // syllabus nodes
  const syllabusIds = [...(byType.get("syllabus") ?? [])];
  if (syllabusIds.length) {
    const { data } = await supabase()
      .from("syllabus_nodes")
      .select("id, paper_code, title_i18n")
      .in("id", syllabusIds);
    for (const n of data ?? []) {
      titles.set(key("syllabus", n.id as string), {
        title: n.title_i18n as BilingualText,
        link: `/learn/${n.paper_code}/${n.id}`,
      });
    }
  }

  // questions
  const questionIds = [...(byType.get("question") ?? [])];
  if (questionIds.length) {
    const { data } = await supabase()
      .from("questions")
      .select("id, stem_i18n, paper_code, syllabus_node_id")
      .in("id", questionIds);
    for (const q of data ?? []) {
      const node = q.syllabus_node_id as string | null;
      // qid: pyq-list.tsx fetches this exact question independently and
      // surfaces it ring-highlighted (scrolled into view), rather than just
      // landing on the PYQ tab's first page and leaving the user to hunt for
      // the cited question themselves.
      titles.set(key("question", q.id as string), {
        title: truncate(q.stem_i18n as BilingualText),
        link: node ? `/learn/${q.paper_code}/${node}?tab=pyqs&qid=${q.id}` : null,
      });
    }
  }

  // notes → resolve through their syllabus node for title + link
  const noteIds = [...(byType.get("note") ?? [])];
  if (noteIds.length) {
    const { data: notes } = await supabase().from("notes").select("id, syllabus_node_id").in("id", noteIds);
    const nodeIds = [...new Set((notes ?? []).map((n) => n.syllabus_node_id as string))];
    const { data: nodes } = nodeIds.length
      ? await supabase().from("syllabus_nodes").select("id, paper_code, title_i18n").in("id", nodeIds)
      : { data: [] as { id: string; paper_code: string; title_i18n: BilingualText }[] };
    const nodeById = new Map((nodes ?? []).map((n) => [n.id as string, n]));
    for (const note of notes ?? []) {
      const node = nodeById.get(note.syllabus_node_id as string);
      titles.set(key("note", note.id as string), {
        title: (node?.title_i18n as BilingualText) ?? { en: "Study note", hi: "अध्ययन नोट" },
        link: node ? `/learn/${node.paper_code}/${node.id}?tab=notes` : null,
      });
    }
  }

  // current affairs
  const caIds = [...(byType.get("current_affairs") ?? [])];
  if (caIds.length) {
    const { data } = await supabase().from("current_affairs_items").select("id, title_i18n").in("id", caIds);
    for (const item of data ?? []) {
      titles.set(key("current_affairs", item.id as string), {
        title: truncate(item.title_i18n as BilingualText),
        // ?item=: opens this exact item's detail sheet directly (see
        // routes/current-affairs.tsx) instead of just landing on the bare,
        // unfiltered feed and leaving the user to find it themselves.
        link: `/current-affairs?item=${item.id}`,
      });
    }
  }

  return chunks.map((c, i) => {
    const resolved = titles.get(key(c.source_type, c.source_id));
    return {
      ref: i + 1,
      source_type: c.source_type,
      source_id: c.source_id,
      title_i18n: resolved?.title ?? { en: "Platform content", hi: "प्लेटफ़ॉर्म सामग्री" },
      link: resolved?.link ?? null,
    };
  });
}

/**
 * Retrieve grounding for a doubt: node-scoped syllabus chunks first (when a page
 * context node is supplied), then the top global semantic hits across all
 * content types, deduped by chunk id and capped at RETRIEVE_K.
 */
export async function retrieveContext(opts: {
  vectorLiteral: string | null;
  locale: Locale;
  nodeId?: string;
}): Promise<MentorContext> {
  if (!opts.vectorLiteral) {
    return { vectorLiteral: null, citations: [], contextText: "", weak: true };
  }
  try {
    const nodeRows = opts.nodeId
      ? await matchEmbeddings(opts.vectorLiteral, {
          locale: opts.locale,
          matchCount: RETRIEVE_K,
          sourceType: "syllabus",
          sourceId: opts.nodeId,
        })
      : [];
    const globalRows = await matchEmbeddings(opts.vectorLiteral, { locale: opts.locale, matchCount: RETRIEVE_K });

    const seen = new Set<string>();
    const merged: MatchRow[] = [];
    for (const row of [...nodeRows, ...globalRows]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      merged.push(row);
      if (merged.length >= RETRIEVE_K) break;
    }

    const topSimilarity = merged.reduce((m, r) => Math.max(m, r.similarity), 0);
    const weak = merged.length === 0 || topSimilarity < WEAK_RETRIEVAL_THRESHOLD;
    const citations = merged.length ? await resolveCitations(merged) : [];

    const contextText = merged
      .map((c, i) => `[${i + 1}] ${c.chunk_text.replace(/\s+/g, " ").trim()}`)
      .join("\n\n");

    return { vectorLiteral: opts.vectorLiteral, citations, contextText, weak };
  } catch (err) {
    logger.warn({ err }, "mentor: retrieval failed; answering ungrounded");
    return { vectorLiteral: opts.vectorLiteral, citations: [], contextText: "", weak: true };
  }
}

// ---------------------------------------------------------------------------
// Doubt-FAQ semantic cache (Feature 3, reworked in Session 26.5)
// ---------------------------------------------------------------------------
export type FaqMode = "normal" | "revision";

export interface FaqCandidate {
  id: string;
  answer: string;
  citations: MentorCitation[];
  mode: FaqMode;
  similarity: number;
}

/**
 * Pull the nearest cached, same-locale doubts (best-first). Returns them raw so
 * the caller can apply the two-tier thresholds and the mode-aware pick; the
 * nearest candidate's similarity is also the value logged on a miss.
 */
export async function lookupFaqCandidates(
  vectorLiteral: string | null,
  locale: Locale,
): Promise<FaqCandidate[]> {
  if (!vectorLiteral) return [];
  try {
    const { data, error } = await supabase().rpc("match_doubt_faq", {
      query_embedding: vectorLiteral,
      filter_locale: locale,
      match_count: FAQ_CANDIDATE_COUNT,
    });
    if (error) throw error;
    return ((data ?? []) as {
      id: string;
      answer: string;
      citations: MentorCitation[] | null;
      mode: string | null;
      similarity: number;
    }[]).map((r) => ({
      id: r.id,
      answer: r.answer,
      citations: r.citations ?? [],
      mode: r.mode === "revision" ? "revision" : "normal",
      similarity: r.similarity,
    }));
  } catch (err) {
    logger.warn({ err }, "mentor: FAQ cache lookup failed");
    return [];
  }
}

/**
 * Persist an answer to the FAQ cache for future no-model reuse — "newest wins".
 * A fresh answer within FAQ_SILENT_THRESHOLD of an existing SAME-MODE entry
 * UPDATES that row (so a regeneration / "Answer fresh" replaces the stale
 * answer) instead of adding a near-duplicate; otherwise it inserts. Mode is
 * stored so the two entries a doubt can have (full vs revision) never merge.
 */
export async function upsertFaqCache(opts: {
  questionText: string;
  vectorLiteral: string | null;
  locale: Locale;
  answer: string;
  citations: MentorCitation[];
  mode: FaqMode;
}): Promise<void> {
  if (!opts.vectorLiteral || !opts.answer.trim()) return;
  const row = {
    question_text: opts.questionText.slice(0, 2000),
    embedding: opts.vectorLiteral,
    locale: opts.locale,
    answer: opts.answer,
    citations: opts.citations,
    mode: opts.mode,
  };
  try {
    const candidates = await lookupFaqCandidates(opts.vectorLiteral, opts.locale);
    const dup = candidates.find((c) => c.mode === opts.mode && c.similarity >= FAQ_SILENT_THRESHOLD);
    if (dup) {
      const { error } = await supabase().from("doubt_faq_cache").update(row).eq("id", dup.id);
      if (error) throw error;
      return;
    }
    const { error } = await supabase().from("doubt_faq_cache").insert(row);
    if (error) throw error;
  } catch (err) {
    logger.warn({ err }, "mentor: FAQ cache write failed");
  }
}
