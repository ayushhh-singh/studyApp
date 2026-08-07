/**
 * `pnpm notes:chapter:checkpoint --stage <s> --exam <code> --nodes <id,id>` …
 *
 * The agent-authored-chapter pipeline's publish half, as a COMMITTED tool.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Chapters are authored by free coding subagents (docs/multi-exam.md §5; the
 * paid `notes:chapter` path is reserved for prod/cron). Those agents are killed
 * by harness session limits constantly — during the UPSC rollout, six died
 * mid-run. Every recovery round then rebuilt the SAME throwaway assemble →
 * resolve → publish → embed → verify script from scratch and lost it again.
 *
 * The lesson that made this a committed file rather than scratch: an authoring
 * agent dying is normal and survivable, but only if the steps AFTER authoring
 * are (a) deterministic, (b) runnable from the main loop without an agent, and
 * (c) one command a future session can find. Publishing needs no judgement —
 * so it must never be the thing an expiring agent is holding.
 *
 * ---------------------------------------------------------------------------
 * ⚑ `scope` IS THE STAGE THAT MATTERS. RUN IT FIRST, ALWAYS.
 * ---------------------------------------------------------------------------
 * Three chapters were published-then-reverted during the UPSC rollout for one
 * reason: TRUNCATED CONTENT THAT PASSES EVERY STRUCTURAL CHECK.
 *
 *   - "History of India and Indian National Movement" shipped with 6 sections,
 *     14 audited facts and valid structure — stopping at the Revolt of 1857 and
 *     omitting the entire INM, i.e. half the node's own title.
 *   - "Environmental Ecology, Bio-diversity and Climate Change" came back from
 *     an agent dispatched SPECIFICALLY to add climate change, with 5 plausible
 *     sections and still zero climate change.
 *
 * Section count and fact count are NOT evidence of completeness. They were the
 * proxy used to select salvage, and they missed all three.
 *
 * Worse, a naive keyword grep also passes: searching the History file for
 * "Quit India" / "Cabinet Mission" / "1947" returns YES for every one — because
 * they appear in the OVERVIEW and FACT-AUDIT metadata while never appearing in
 * a section body. The chapter advertises coverage it does not contain.
 *
 * So `--stage scope` reports, per term, whether it appears in written prose
 * versus only in metadata. A term that is METADATA-ONLY is the signature of a
 * truncated chapter and is reported as a FAIL. Judgement about which terms a
 * node requires stays with the operator — this stage makes the evidence
 * mechanical, not the decision.
 *
 * PROSE here means everything the reader actually reads: section HEADINGS,
 * `body_md_i18n`, `boxes[].content_i18n`, and a `table`-kind diagram's
 * `source_i18n` (which is a markdown table the reader renders). A `mermaid`
 * diagram is reported as DIAGRAM-ONLY instead — a node label summarises
 * something taught elsewhere rather than teaching it, so the operator judges.
 * See the fourth failure mode below for why boxes and tables had to be added.
 *
 * ⚑ AND IT IS STILL NOT SUFFICIENT ON ITS OWN. A third variant slipped past
 * this very stage: the `Logical Reasoning` chapter reported SCOPE: PASS for
 * "coding" and "cause and effect" because both appear in prose — inside the
 * opening section that ENUMERATES the node's four declared techniques ("its
 * own description narrows the parent's territory to exactly four: syllogisms,
 * statement and assumption, cause and effect, and coding"). A scope-DECLARING
 * sentence is not coverage; that chapter teaches two of the four and never
 * returns to the others. So:
 *   1. Derive terms from the node's OWN `description_i18n` / children in the
 *      DB, never from what you remember the node to be about. That is how the
 *      two missing techniques were found at all.
 *   2. When a term's only hits are in an overview or a "what this covers"
 *      section, treat it as ABSENT. Check WHICH section the hit is in — the
 *      stage prints headings above the table precisely so you can.
 *
 * ⚑ A THIRD FAILURE MODE, but this one is in the OPERATOR's query, not the
 * tool: "--terms world climatic types" reported FAIL on a chapter whose body
 * genuinely said "the world's climatic types" — a plain substring match, so
 * the possessive apostrophe-s broke it. Before trusting a FAIL, try the
 * shorter, punctuation-free fragment of the term ("climatic types" instead of
 * "world climatic types") before concluding the content is missing.
 *
 * ---------------------------------------------------------------------------
 * ⚑ SUPERSEDING AN ALREADY-PUBLISHED CHAPTER — USE `dump`, NEVER RE-AUTHOR
 * ---------------------------------------------------------------------------
 * A chapter found TRUNCATED or THIN after publication is fixed by ADDING to it,
 * not by writing a new one: `persistChapter` upserts on `syllabus_node_id` and
 * bumps `chapter_version`, so the richer version replaces the poorer one in
 * place (the rollout's established richer-supersedes move). But the assemble
 * input is the WHOLE chapter, so a supersede pass needs the current sections
 * back in editable form first — otherwise an agent re-authors prose that was
 * already correct, and the "fix" silently rewrites content nobody reviewed.
 *
 * `--stage dump --dir <d>` writes each node's persisted chapter back out as a
 * `chapterAssembleInput` JSON. It is LOSSLESS by construction: the file it
 * writes re-assembles to byte-identical `sections` / `fact_audit_facts` /
 * `sources`, so an untouched dump→assemble round trip changes nothing but
 * `chapter_version`. Edit the file, then run assemble → resolve → publish →
 * embed → verify exactly as for a fresh chapter.
 *
 * ⚑ THE CHAPTER GOES OFF THE LIVE SITE BETWEEN `assemble` AND `publish`.
 * `persistChapter` resets status to `needs_review` and DELETES the note's
 * embeddings, so retrieval loses it too. Finish the cycle per chapter; do not
 * assemble a batch and leave it parked.
 *
 * ---------------------------------------------------------------------------
 * STAGES
 * ---------------------------------------------------------------------------
 *   dump     : persisted chapter → editable assemble-input JSON. NO writes.
 *   scope    : section headings + prose-vs-metadata term placement. NO writes.
 *   assemble : validate + assembleChapter per node, then print the fact_audit
 *              so flags can be judged INDIVIDUALLY.
 *   resolve  : mark ONLY the fact ids named on --facts resolved, through the
 *              real editNote() service fn. There is deliberately NO
 *              "resolve all" — blanket-resolving to force a publish defeats
 *              the gate. Judge each flag, then name it.
 *   publish  : approveNote per node. Fails loudly while a flag is unresolved;
 *              that gate is the point.
 *   embed    : embedNotes({ nodeId }) IN PROCESS, scoped to these nodes only.
 *              Never a bare embedNotes() (re-embeds the whole bank) and never
 *              a shelled-out per-note CLI call — that silently swallowed
 *              failures and left 90 of 128 chapters with zero embeddings.
 *   verify   : per-note head count of embeddings — NOT a batched .in(), which
 *              pools past PostgREST's 1000-row cap and reported 97 false
 *              "missing embedding" gaps.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "../src/ingest/_shared.js";
import { chapterAssembleInputSchema, assembleChapter } from "../src/notes/chapter-assemble.js";
import { embedNotes } from "../src/notes/embed.js";
import { approveNote, editNote } from "../src/services/notes.js";
import { supabase } from "../src/lib/supabase.js";

const STAGES = ["dump", "scope", "assemble", "resolve", "publish", "embed", "verify"] as const;
type Stage = (typeof STAGES)[number];

const args = parseArgs(
  process.argv.slice(2),
  { value: ["stage", "exam", "dir", "nodes", "facts", "terms"] },
  "notes:chapter:checkpoint",
);

const stage = String(args.stage ?? "") as Stage;
if (!STAGES.includes(stage)) {
  throw new Error(`--stage must be one of ${STAGES.join(" | ")} (got ${JSON.stringify(args.stage)})`);
}
const examCode = String(args.exam ?? "");
if (!examCode) throw new Error("--exam <code> is required");
const dir = typeof args.dir === "string" ? args.dir : "";
const nodes = String(args.nodes ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (nodes.length === 0) throw new Error("--nodes <id,id,…> is required");

const sb = supabase();

/** The subset of a chapter section this stage reads. */
interface ChapterSectionish {
  id: string;
  heading_i18n?: Record<string, string>;
  body_md_i18n?: Record<string, string>;
  boxes?: { content_i18n?: Record<string, string> }[];
  diagram?: { kind: string; source_i18n?: Record<string, string> } | null;
}

interface NoteRow {
  id: string;
  status: string;
  chapter_version: number | null;
  fact_audit: {
    facts?: { id: string; section_id: string; claim: string; status: string; evidence: string; resolved: boolean }[];
  } | null;
  study_content_i18n: { sections?: ChapterSectionish[] } | null;
  content_i18n: Record<string, { overview?: string; quick_revision?: string[] }> | null;
  sources: unknown[] | null;
  meta: Record<string, unknown> | null;
}

const NOTE_COLUMNS =
  "id, status, chapter_version, fact_audit, study_content_i18n, content_i18n, sources, meta";

async function noteFor(nodeId: string): Promise<NoteRow | null> {
  const { data, error } = await sb
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("syllabus_node_id", nodeId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as NoteRow | null) ?? null;
}

/** Read a chapter either from disk (pre-assemble) or from the persisted note. */
async function sectionsFor(nodeId: string) {
  if (dir) {
    const raw = JSON.parse(readFileSync(`${dir}/${nodeId}.json`, "utf8"));
    return { sections: raw.sections ?? [], whole: raw };
  }
  const note = await noteFor(nodeId);
  if (!note) throw new Error(`no note for ${nodeId} (and no --dir given)`);
  return { sections: note.study_content_i18n?.sections ?? [], whole: note };
}

for (const nodeId of nodes) {
  if (stage === "dump") {
    if (!dir) throw new Error("--dir <path> is required for --stage dump");
    const note = await noteFor(nodeId);
    if (!note) throw new Error(`no note for ${nodeId} — nothing to supersede`);
    const sections = note.study_content_i18n?.sections ?? [];
    if (sections.length === 0) {
      throw new Error(`${nodeId} has a note but no chapter sections — author it fresh, don't dump`);
    }
    // The digest (content_i18n) is the Quick Revision layer and persistChapter
    // PRESERVES it whenever its overview is bilingual-complete — so these two
    // fields are round-tripped for schema completeness, not because a reload
    // rewrites them. `meta` carries section_plan / web_search_used /
    // machine_translated from the authoring pass; preserve them so a supersede
    // does not silently reset a chapter's recorded provenance.
    const out = {
      node_id: nodeId,
      overview_i18n: {
        hi: note.content_i18n?.hi?.overview ?? "",
        en: note.content_i18n?.en?.overview ?? "",
      },
      quick_revision_i18n: {
        hi: note.content_i18n?.hi?.quick_revision ?? [],
        en: note.content_i18n?.en?.quick_revision ?? [],
      },
      sections,
      fact_audit_facts: note.fact_audit?.facts ?? [],
      sources: note.sources ?? [],
      section_plan: (note.meta?.section_plan as unknown[]) ?? [],
      web_search_used: note.meta?.web_search_used === true,
      // A supersede pass derives its NEW Hindi by translating the English it
      // just wrote, which is exactly what this flag records (see
      // chapter-generate.ts, which hardcodes true for that reason). Default to
      // the stored value here; the editing pass must set it to true once it has
      // added translated prose.
      machine_translated: note.meta?.machine_translated !== false,
    };
    // Parse before writing: a dump that cannot be re-assembled is worse than no
    // dump, because the failure would surface only after an agent had edited it.
    chapterAssembleInputSchema.parse(out);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${nodeId}.json`);
    writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
    console.log(
      `dumped ${nodeId} → ${path} (v${note.chapter_version}, ${sections.length} sections, ` +
        `${out.fact_audit_facts.length} facts, ${out.sources.length} sources, status=${note.status})`,
    );
  } else if (stage === "scope") {
    const { sections, whole } = await sectionsFor(nodeId);
    // PROSE = section HEADINGS + section BODIES. Headings are authored content
    // and are frequently where a topic's name actually lives: the History
    // chapter has a section titled "Quit India: the August Revolution of 1942"
    // whose body says Wardha, Gowalia Tank, "Do or Die" and Aruna Asaf Ali but
    // never repeats the literal phrase — because the heading already carries
    // it. Checking bodies alone reported that as METADATA-ONLY, i.e. a false
    // FAIL on a chapter that genuinely covers the topic. Including headings
    // does NOT weaken the original catch: when that same chapter really was
    // truncated, "Quit India" appeared in no heading and no body either.
    // ⚑ A FOURTH FAILURE MODE, and it is in THIS TOOL, not the operator or the
    // chapter: PROSE originally meant headings + bodies ONLY. But a chapter also
    // teaches in `boxes[].content_i18n` and in a `table`-kind diagram, whose
    // `source_i18n` IS a markdown table the reader renders. Both were invisible
    // here, so a genuinely-taught topic came back METADATA-ONLY — a FALSE FAIL,
    // which is the dangerous direction: it invites someone to "fix" a chapter by
    // duplicating content it already has, i.e. the exact overlap defect this
    // pipeline keeps having to repair.
    //
    // Caught live on Indian Heritage: Yakshagana / Nautanki / Tamasha reported
    // METADATA-ONLY while being taught in a Form|Region|What-distinguishes-it
    // table, with the Hindi variant carrying the Devanagari names too. The blast
    // radius was bank-wide — ALL 362 published chapters have boxes and 151 use a
    // table diagram, so every scope run in this rollout was under-reading.
    //
    // A `mermaid` diagram is deliberately EXCLUDED from prose: a node label is a
    // summary of something taught elsewhere, not teaching. It is reported on its
    // own line instead, so the operator can see it and judge — the same
    // "mechanical evidence, human decision" split as the rest of this stage.
    const proseOf = (s: ChapterSectionish) => [
      s.heading_i18n ?? {},
      s.body_md_i18n ?? {},
      (s.boxes ?? []).map((b) => b.content_i18n ?? {}),
      s.diagram?.kind === "table" ? s.diagram.source_i18n ?? {} : {},
    ];
    const prose = JSON.stringify(sections.map(proseOf)).toLowerCase();
    const mermaidOnly = JSON.stringify(
      sections.map((s: ChapterSectionish) => (s.diagram?.kind === "mermaid" ? s.diagram.source_i18n ?? {} : {})),
    ).toLowerCase();
    const everything = JSON.stringify(whole).toLowerCase();
    console.log(`\n=== ${nodeId} — ${sections.length} section(s)`);
    for (const s of sections) {
      console.log(`   - ${(s.heading_i18n?.en ?? "?").slice(0, 76)}`);
    }
    const terms = String(args.terms ?? "")
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (terms.length === 0) {
      console.log("   (pass --terms to test required sub-topic coverage)");
      continue;
    }
    let failed = 0;
    console.log("   term                           in PROSE | anywhere");
    for (const t of terms) {
      const inProse = prose.includes(t);
      const anywhere = everything.includes(t);
      const inMermaid = mermaidOnly.includes(t);
      // METADATA-ONLY is the truncation signature: the chapter promises the
      // topic in its overview/fact-audit but never actually writes it.
      // DIAGRAM-ONLY is weaker evidence than prose but is NOT metadata — the
      // operator decides whether a mermaid node label counts for this term.
      const verdict = inProse ? "ok" : inMermaid ? "DIAGRAM-ONLY ⚑" : anywhere ? "METADATA-ONLY ⚑" : "ABSENT ⚑";
      if (!inProse) failed++;
      console.log(`   ${t.padEnd(30)} ${String(inProse).padEnd(8)} | ${anywhere}   ${verdict}`);
    }
    console.log(failed === 0 ? "   SCOPE: PASS" : `   SCOPE: FAIL — ${failed} term(s) not in written prose`);
  } else if (stage === "assemble") {
    if (!dir) throw new Error("--dir <path> is required for --stage assemble");
    const raw = JSON.parse(readFileSync(`${dir}/${nodeId}.json`, "utf8"));
    const input = chapterAssembleInputSchema.parse(raw);
    console.log(
      `\n=== ${nodeId} — ${input.sections.length} sections, ${input.fact_audit_facts.length} facts, ${input.sources.length} sources`,
    );
    const res = await assembleChapter(input, (m) => console.log(m));
    if (res.droppedMissing.length) console.log(`  DROPPED (nonexistent) pyq ids: ${res.droppedMissing.join(", ")}`);
    const note = await noteFor(nodeId);
    const facts = note?.fact_audit?.facts ?? [];
    const bad = facts.filter((f) => f.status !== "verified" && !f.resolved);
    console.log(
      `  note ${note?.id} status=${note?.status} v=${note?.chapter_version} facts=${facts.length} unresolved_flags=${bad.length}`,
    );
    for (const f of bad) console.log(`    [${f.status}] ${f.id} (${f.section_id}): ${f.claim}\n        evidence: ${f.evidence}`);
  } else if (stage === "resolve") {
    const spec = String(args.facts ?? "");
    const forNode = spec
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split(":"))
      .find(([n]) => n === nodeId);
    const wanted = new Set((forNode?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    if (wanted.size === 0) {
      console.log(`${nodeId}: no fact ids given — nothing resolved`);
      continue;
    }
    const note = await noteFor(nodeId);
    if (!note) throw new Error(`no note for ${nodeId}`);
    const facts = note.fact_audit?.facts ?? [];
    const unknown = [...wanted].filter((id) => !facts.some((f) => f.id === id));
    if (unknown.length) throw new Error(`${nodeId}: unknown fact id(s) ${unknown.join(", ")}`);
    const next = facts.map((f) => (wanted.has(f.id) ? { ...f, resolved: true } : f));
    await editNote(note.id, { fact_audit: { ...(note.fact_audit ?? {}), facts: next } } as never);
    const after = await noteFor(nodeId);
    const still = (after?.fact_audit?.facts ?? []).filter((f) => f.status !== "verified" && !f.resolved);
    console.log(`${nodeId}: resolved ${[...wanted].join(", ")} — ${still.length} unresolved flag(s) remain`);
  } else if (stage === "publish") {
    const note = await noteFor(nodeId);
    if (!note) throw new Error(`no note for ${nodeId}`);
    const r = await approveNote(note.id);
    console.log(`published ${nodeId} note=${r.id} status=${r.status}`);
  } else if (stage === "embed") {
    const r = await embedNotes({ nodeId });
    console.log(`embedded ${nodeId}:`, JSON.stringify(r));
  } else {
    const note = await noteFor(nodeId);
    if (!note) throw new Error(`no note for ${nodeId}`);
    const { count, error } = await sb
      .from("embeddings")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "note")
      .eq("source_id", note.id);
    if (error) throw new Error(error.message);
    const { count: mismatch } = await sb
      .from("embeddings")
      .select("id", { count: "exact", head: true })
      .eq("source_type", "note")
      .eq("source_id", note.id)
      .neq("exam_code", examCode);
    console.log(
      `${nodeId} note=${note.id} status=${note.status} v=${note.chapter_version} ` +
        `sections=${note.study_content_i18n?.sections?.length ?? 0} chunks=${count} foreign_exam_chunks=${mismatch}`,
    );
  }
}
