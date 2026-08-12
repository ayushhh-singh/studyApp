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
import type { BilingualText, Locale, MentorCitation, QuestionOption } from "@neev/shared";
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
  /**
   * The retrieved chunk texts, raw and unlabelled, in the same order.
   *
   * `contextText` is formatted FOR THE MODEL and its shape is not a parsing
   * contract: teacher mode used to rebuild facts from it by regex-stripping the
   * leading "[n] ", which silently started leaving the whole
   * "(past exam question; verified correct option: …)" label glued to every
   * fact the moment labelling shipped. Anything that needs the content rather
   * than the prompt should read this instead of re-parsing that string.
   */
  chunkTexts: string[];
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
  opts: { locale: Locale; matchCount: number; examCode: string; sourceType?: string; sourceId?: string },
): Promise<MatchRow[]> {
  const { data, error } = await supabase().rpc("match_embeddings", {
    query_embedding: vectorLiteral,
    match_count: opts.matchCount,
    filter_locale: opts.locale,
    filter_source_type: opts.sourceType ?? null,
    filter_source_id: opts.sourceId ?? null,
    // Inside the RPC, not applied to the returned rows (0107). Post-filtering an
    // ANN top-k is not a filter, it is a truncation: another exam's chapter on
    // the same topic embeds almost identically, so it can occupy the entire
    // top-k and leave the user with no grounding at all.
    filter_exam_code: opts.examCode,
  });
  if (error) throw new Error(`match_embeddings failed: ${error.message}`);
  return (data ?? []) as MatchRow[];
}

/**
 * What each retrieved chunk IS, in the words the mentor sees. Without this the
 * context block was a flat `[n] <text>` list in which a PYQ stem, a syllabus
 * line and an authored chapter paragraph are indistinguishable (G4/B5) — and a
 * question stem read as prose is a list of assertions of which at most one is
 * true. Unknown types fall back to the raw source_type rather than being
 * silently dropped or mislabelled.
 */
const SOURCE_LABELS: Record<string, string> = {
  syllabus: "syllabus topic",
  question: "past exam question",
  note: "study chapter",
  current_affairs: "current affairs item",
};

/**
 * Does this option's TEXT read as a bare ordering/matching code ("II, I, III, IV",
 * "2, 1, 4, 3") rather than a self-contained answer?
 *
 * Found by validating the fix rather than by review: handed
 * `verified correct option: A — "II, I, III, IV"` for a chronology question, the
 * mentor read the code left-to-right as the sequence itself and reported
 * "Sarnul → Bilgram → …" when II,I,… means Bilgram FIRST — then presented that
 * as what our verified key confirms. A wrong order wearing the platform's
 * authority is worse than the silence this whole change is fixing.
 *
 * A code is therefore decoded for the mentor where that can be done with
 * certainty (`decodeOrderingCode`), and only labelled as a code where it cannot.
 */
function looksLikeOrderingCode(text: string): boolean {
  return /^[IVXLCivxlc\d]+(\s*[,;–—-]\s*[IVXLCivxlc\d]+){1,}$/.test(text.trim());
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 };
function ordinalOf(token: string): number {
  if (/^\d+$/.test(token)) return Number(token);
  if (!/^[IVXL]+$/.test(token)) return NaN;
  let n = 0;
  for (let i = 0; i < token.length; i++) {
    const v = ROMAN[token[i]];
    n += v < (ROMAN[token[i + 1]] ?? 0) ? -v : v;
  }
  return n;
}

/** Stems that actually pose a SEQUENCE (not a pairing, not a set). */
const SEQUENCE_CUE =
  /arrange|chronolog|sequence|ascending|descending|correct order|in order|क्रम|व्यवस्थित|कालानुक्रम/i;

/**
 * Is this really an ordering code for THIS stem — a permutation of 1..n paired
 * with a stem that asks for a sequence?
 *
 * `looksLikeOrderingCode` alone is far too loose, measured over all 5,321
 * published MCQs: of 232 correct-options matching it, **38 are not ordering
 * codes at all** — a year range ("2021-22"), a money value ("55,550"), a pair
 * of unknowns ("8, 7"), a set of correct statements ("2, 3, 5, 7") — and a
 * further 57 are Match-List codes, where the answer is a PAIRING and rendering
 * it as `A → B → C` would be nonsense. Both classes were being handed the
 * "this is a CODE, map each numeral…" note, which is actively misleading for
 * them. They now get the plain option text instead.
 */
function isOrderingSequence(stem: string, code: string): boolean {
  const tokens = code.split(/[,;–—-]/).map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (tokens.length < 3) return false;
  const vals = tokens.map(ordinalOf);
  if (vals.some((v) => !Number.isFinite(v))) return false;
  const distinct = new Set(vals);
  if (distinct.size !== vals.length) return false;
  if (![...distinct].every((v) => v >= 1 && v <= vals.length)) return false;
  return SEQUENCE_CUE.test(stem);
}

/**
 * Trailing instruction that runs into the LAST enumerated item ("… IV. Battle
 * of Jajau Select the correct answer from the codes given below").
 *
 * ⚑ The lookahead is `(?![\p{L}\p{M}])` with the `u` flag, NOT `\b`. JavaScript's
 * `\b` is ASCII-word-based, so after a Devanagari keyword like `कूट` it does not
 * match and the whole clip silently no-ops — measured: 52 Hindi decodes were
 * carrying the full instruction inside the item name ("केशवानंद भारती बनाम केरल
 * राज्य नीचे दिए गए कूट में से सही उत्तर चुनिए") while English clipped correctly.
 * The same Hindi-blind-spot class as §9a's A9, in this fix.
 */
const TAIL_INSTRUCTION = /\s*(?:Select|Choose|Codes?|कूट|उपर्युक्त|नीचे|सूचियों)(?![\p{L}\p{M}])/iu;

/**
 * Turn an ordering code into the actual named sequence, by mapping each token
 * onto the correspondingly-numbered item enumerated in the stem.
 *
 * Returns null unless the mapping is UNAMBIGUOUS AND TOTAL — every code token
 * resolves to exactly one enumerated item, no token repeats, and the stem
 * enumerates exactly as many items as the code orders. Anything less falls back
 * to labelling it a code, because a MIS-decode is the one outcome worse than
 * not decoding: the mentor restates the sequence as "the verified order", so a
 * wrong decode ships a wrong chronology wearing the platform's authority.
 * Measured: the warn-only version got one such question right and the other
 * wrong in a single reply, which is what motivated decoding here.
 */
function decodeOrderingCode(stem: string, code: string): string | null {
  const tokens = code
    .split(/[,;–—-]/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (tokens.length < 2 || new Set(tokens).size !== tokens.length) return null;

  // Enumeration markers: "I. ", "1) ", "(iv) " … at a word boundary.
  const marker = /(?:^|[\s(])((?:[IVXLC]+|\d+))[.)]\s+/gi;
  const marks: { label: string; end: number; start: number }[] = [];
  for (let m = marker.exec(stem); m; m = marker.exec(stem)) {
    marks.push({ label: m[1].toUpperCase(), start: m.index, end: marker.lastIndex });
  }
  if (marks.length !== tokens.length) return null;

  const byLabel = new Map<string, string>();
  for (let i = 0; i < marks.length; i++) {
    const rawText = stem.slice(marks[i].end, marks[i + 1]?.start ?? stem.length);
    // Clip ONLY the last item. Every earlier item is already bounded by the next
    // enumeration marker, so clipping them can only ever cut a real name short —
    // "1. Indian Penal Code and CrPC" became "Indian Penal" under the previous
    // clip-everything version. The closing instruction can only follow the final
    // item, so that is the only place it needs removing.
    const isLast = i === marks.length - 1;
    // ⚑ Structural pre-split BEFORE collapsing whitespace, found auditing this
    // fix against real upsc PYQs (whose closing question is phrased as a direct
    // WH-question — "What is the correct chronological sequence…?" / "…निम्नलिखित
    // में से कौन-सा…" — never "Select"/"Choose"/"Codes", so TAIL_INSTRUCTION alone
    // never matched and the whole trailing sentence stayed attached to the item:
    // "Second Round Table Conference What is the correct chronological sequence
    // of the above events?"). These list-style stems put the closing instruction
    // on its OWN LINE after the last item — a signal `.replace(/\s+/g, " ")`
    // destroyed by running first. Splitting on the first raw newline recovers it
    // and, being structural rather than lexical, needs no per-phrasing word list;
    // measured on the FULL bank (both exams, 137 genuine sequences): 3 previously
    // garbled decodes now clip clean, 3 previously-safe-fallback cases now decode
    // correctly, 0 regressions. TAIL_INSTRUCTION still runs on the remainder,
    // unchanged, for same-line instructions ("… Select the correct answer using
    // the codes given below" with no newline) — this is additive, not a
    // replacement.
    const structurallyClipped = isLast ? (rawText.split(/\r?\n/)[0] ?? rawText) : rawText;
    const text = structurallyClipped.replace(/\s+/g, " ").trim();
    const clipped = (isLast ? text.split(TAIL_INSTRUCTION)[0] : text).replace(/[.:;]+$/, "").trim();
    if (!clipped || clipped.length > 120 || byLabel.has(marks[i].label)) return null;
    byLabel.set(marks[i].label, clipped);
  }
  const seq = tokens.map((t) => byLabel.get(t));
  if (seq.some((s) => !s)) return null;
  return seq.join(" → ");
}

interface ResolvedChunks {
  citations: MentorCitation[];
  /**
   * question source_id → the verified answer, phrased for the context block.
   * Only present for an MCQ that actually has a key and a matching option.
   */
  answerNotes: Map<string, string>;
}

/**
 * Resolve retrieved chunks (in retrieval order) to numbered citations with a
 * title and deep link, batching one lookup per source type.
 *
 * Also returns each question chunk's VERIFIED ANSWER (G4/B2-B3). A `question`
 * embedding is `stem + options + explanation` (`ingest/embed.ts`) and
 * deliberately omits `correct_option_key`, so the mentor was handed four
 * mutually exclusive options with no marker of which is right and filled the
 * gap from parametric memory — getting the ordering, date and actors of a
 * battle wrong while OUR OWN ROW held the web-verified key. The key is read
 * here rather than embedded because this piggybacks on a `questions` lookup
 * `resolveCitations` already performs on ids already in hand: no extra round
 * trip, and no re-embed of ~7,000 questions × 2 locales.
 */
async function resolveCitations(chunks: MatchRow[], locale: Locale): Promise<ResolvedChunks> {
  const byType = new Map<string, Set<string>>();
  for (const c of chunks) {
    const set = byType.get(c.source_type) ?? new Set<string>();
    set.add(c.source_id);
    byType.set(c.source_type, set);
  }
  const answerNotes = new Map<string, string>();

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
      .select("id, stem_i18n, paper_code, syllabus_node_id, type, correct_option_key, options_i18n")
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

      // The answer note, when there genuinely is one. A descriptive question
      // has no key by design, and an MCQ can carry a key whose option is
      // missing from a partially-captured row — in both cases the snippet just
      // keeps its "past exam question" label and claims nothing further. Never
      // synthesise or guess a key here: a WRONG stated answer would be worse
      // than the silence this is fixing.
      const stem = q.stem_i18n as BilingualText;
      const optionKey = q.correct_option_key as string | null;
      if (q.type === "mcq" && optionKey) {
        const options = (q.options_i18n as QuestionOption[] | null) ?? [];
        const correct = options.find((o) => o?.key === optionKey);
        const text = (correct?.text_i18n?.[locale] ?? correct?.text_i18n?.en ?? "").trim();
        const clean = text.replace(/\s+/g, " ").slice(0, 200);
        // Decode against the stem in the SAME language as the option text, so a
        // Hindi code never resolves to English item names (or vice versa).
        const stemText = (stem[locale] ?? stem.en ?? "").trim();
        // The ordering branches apply only to a genuine sequence code; a
        // Match-List pairing, a year range or a money value takes the plain note.
        const isSequence = clean.length > 0 && looksLikeOrderingCode(clean) && isOrderingSequence(stemText, clean);
        const decoded = isSequence ? decodeOrderingCode(stemText, clean) : null;
        answerNotes.set(
          q.id as string,
          !clean
            ? `verified correct option: ${optionKey}`
            : decoded
              ? `verified correct option: ${optionKey} — "${clean}", i.e. ${decoded}`
              : isSequence
                ? `verified correct option: ${optionKey} — "${clean}", which is a CODE, not a sequence of names: ` +
                  `map each numeral to the item numbered the same way in the stem above, in exactly this left-to-right order`
                : `verified correct option: ${optionKey} — "${clean}"`,
        );
      }
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

  const citations = chunks.map((c, i) => {
    const resolved = titles.get(key(c.source_type, c.source_id));
    return {
      ref: i + 1,
      source_type: c.source_type,
      source_id: c.source_id,
      title_i18n: resolved?.title ?? { en: "Platform content", hi: "प्लेटफ़ॉर्म सामग्री" },
      link: resolved?.link ?? null,
    };
  });
  return { citations, answerNotes };
}

/**
 * Retrieve grounding for a doubt: node-scoped syllabus chunks first (when a page
 * context node is supplied), then the top global semantic hits across all
 * content types, deduped by chunk id and capped at RETRIEVE_K.
 */
export async function retrieveContext(opts: {
  vectorLiteral: string | null;
  locale: Locale;
  /**
   * The asking user's own exam. Required, not defaulted — this decides which
   * exam's chapters the mentor may quote and cite, and a default would quietly
   * make that "UPPSC" for everyone. Chunks with a NULL exam_code (shared current
   * affairs) match every exam.
   */
  examCode: string;
  nodeId?: string;
}): Promise<MentorContext> {
  if (!opts.vectorLiteral) {
    return { vectorLiteral: null, citations: [], contextText: "", chunkTexts: [], weak: true };
  }
  try {
    const nodeRows = opts.nodeId
      ? await matchEmbeddings(opts.vectorLiteral, {
          locale: opts.locale,
          matchCount: RETRIEVE_K,
          examCode: opts.examCode,
          sourceType: "syllabus",
          sourceId: opts.nodeId,
        })
      : [];
    const globalRows = await matchEmbeddings(opts.vectorLiteral, {
      locale: opts.locale,
      matchCount: RETRIEVE_K,
      examCode: opts.examCode,
    });

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
    const { citations, answerNotes } = merged.length
      ? await resolveCitations(merged, opts.locale)
      : { citations: [], answerNotes: new Map<string, string>() };

    // Each snippet carries WHAT IT IS, and a question snippet carries its
    // verified key. Both are per-message user content sitting after every
    // prompt-cache breakpoint, so this costs the cache nothing.
    const contextText = merged
      .map((c, i) => {
        const label = SOURCE_LABELS[c.source_type] ?? c.source_type;
        const note = c.source_type === "question" ? answerNotes.get(c.source_id) : undefined;
        const tag = note ? `${label}; ${note}` : label;
        return `[${i + 1}] (${tag}) ${c.chunk_text.replace(/\s+/g, " ").trim()}`;
      })
      .join("\n\n");

    const chunkTexts = merged.map((c) => c.chunk_text.replace(/\s+/g, " ").trim());
    return { vectorLiteral: opts.vectorLiteral, citations, contextText, chunkTexts, weak };
  } catch (err) {
    logger.warn({ err }, "mentor: retrieval failed; answering ungrounded");
    return { vectorLiteral: opts.vectorLiteral, citations: [], contextText: "", chunkTexts: [], weak: true };
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
  examCode: string,
): Promise<FaqCandidate[]> {
  if (!vectorLiteral) return [];
  try {
    const { data, error } = await supabase().rpc("match_doubt_faq", {
      query_embedding: vectorLiteral,
      filter_locale: locale,
      match_count: FAQ_CANDIDATE_COUNT,
      // Scopes the cache in BOTH directions, because upsertFaqCache reuses this
      // same lookup as its near-duplicate check: one exam's user can never be
      // served another exam's framing (silently, at >= 0.95, with no model call
      // and nothing in the UI to show it), and one exam's regenerated answer can
      // never overwrite another exam's cached row.
      filter_exam_code: examCode,
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
  /** The exam this answer was FRAMED for — part of the dedup key, not metadata. */
  examCode: string;
  answer: string;
  citations: MentorCitation[];
  mode: FaqMode;
}): Promise<void> {
  if (!opts.vectorLiteral || !opts.answer.trim()) return;
  const row = {
    question_text: opts.questionText.slice(0, 2000),
    embedding: opts.vectorLiteral,
    locale: opts.locale,
    exam_code: opts.examCode,
    answer: opts.answer,
    citations: opts.citations,
    mode: opts.mode,
  };
  try {
    // Same-exam candidates only — see the filter in lookupFaqCandidates. Without
    // it "newest wins" would let a UPPSC answer UPDATE the MPPSC row it happens
    // to sit within 0.95 of, destroying the other exam's cached answer.
    const candidates = await lookupFaqCandidates(opts.vectorLiteral, opts.locale, opts.examCode);
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

