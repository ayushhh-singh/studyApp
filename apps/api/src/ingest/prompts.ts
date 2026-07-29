/**
 * Exam-parameterised SYSTEM prompts for the three ingest CLIs
 * (explain.ts, syllabus.ts, pyq.ts).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Each of those three files exports NOTHING and ends in a bare, unguarded
 * top-level `main().catch(...)`, so `pnpm prompts:snapshot` cannot import them:
 * a dynamic import would immediately run the real ingest (Supabase writes,
 * Anthropic batch jobs, process.exit on failure). Adding an
 * `if (process.argv[1].endsWith(...))` guard is NOT the fix — this repo has a
 * recorded incident where a scratch filename ending in the same substring
 * self-triggered exactly such a guard and ran a whole-bank re-embed (see
 * CLAUDE.md's `_tmp_reembed.ts` note).
 *
 * So the prompt text lives HERE instead: a side-effect-free module (its only
 * imports are the exam-config lookups) that the CLIs import. That makes every
 * exam-bearing ingest prompt reachable by the byte-identity harness without any
 * argv guard and without the harness ever touching a CLI entrypoint.
 *
 * SCOPE: only the strings whose content varies per exam. The schemas and the
 * per-question user-content builders stay in their own CLI files — they carry no
 * exam framing, so moving them would enlarge the diff for no verification gain.
 */
import { getExamConfig, requireAuthored } from "../lib/exam-config.js";

/**
 * Memoise a per-exam prompt build: one string instance per exam across a whole
 * batch, so a 500-question run does not rebuild the same system prompt 500
 * times. (Was local to explain.ts before this module existed.)
 */
function memoisePerExam(build: (examCode: string) => string): (examCode: string) => string {
  const cache = new Map<string, string>();
  return (examCode: string) => {
    const hit = cache.get(examCode);
    if (hit !== undefined) return hit;
    const built = build(examCode);
    cache.set(examCode, built);
    return built;
  };
}

// ---------------------------------------------------------------------------
// ingest/explain.ts — the two-stage grounded explanation batch
// ---------------------------------------------------------------------------

/** Stage 1: does the evidence actually support the STORED answer key? */
export const supportSystem = memoisePerExam(
  (examCode) =>
    `You are auditing ${requireAuthored(getExamConfig(examCode).misc.ingestKeySupportFraming, examCode, "misc.ingestKeySupportFraming")} before an explanation is written for it. You are given the question, its options, ` +
    "reference passages, and the STORED answer key. Using the passages and well-established knowledge, decide whether the " +
    "evidence genuinely supports the stored key being the single correct option. Do NOT assume the stored key is right — " +
    "check it. If it is clearly wrong, say which option the evidence actually supports. Name the decisive fact. Return strict JSON only.",
);

/** Stage 2: author the bilingual explanation for the verified correct option. */
export const explainSystem = memoisePerExam(
  (examCode) =>
    `You write ${requireAuthored(getExamConfig(examCode).misc.explanationFraming, examCode, "misc.explanationFraming")} for exam aspirants, in BOTH Hindi (Devanagari) and English. You are given the ` +
    "verified correct option — write a concise explanation (3-5 sentences per language) that argues FOR that option using " +
    "the reference passages, and briefly why each other option is wrong. Ground every factual claim in the passages or " +
    "well-established knowledge; never invent a date, article, name, or number. Plain prose only — no markdown, no headers, " +
    "no bold/italic asterisks, no bullet lists. Return strict JSON only.",
);

// ---------------------------------------------------------------------------
// ingest/syllabus.ts — structuring one paper's official syllabus PDF into a tree
// ---------------------------------------------------------------------------

export function buildStructurePaperSystem(examCode: string): string {
  const cfg = getExamConfig(examCode).misc;
  return (
    `You are an expert on ${requireAuthored(cfg.syllabusExpertFraming, examCode, "misc.syllabusExpertFraming")}. ` +
    "You build a clean, hierarchical syllabus tree for ONE paper. " +
    `Ground every node in the provided official syllabus text; use ${requireAuthored(cfg.syllabusStructureNote, examCode, "misc.syllabusStructureNote")} ` +
    "to organise topics into sections and sub-topics. " +
    "Do NOT invent topics that contradict the source."
  );
}

// ---------------------------------------------------------------------------
// ingest/pyq.ts — mapping extracted PYQs onto syllabus nodes
// ---------------------------------------------------------------------------

export function buildNodeClassifySystem(examCode: string): string {
  const questions = requireAuthored(
    getExamConfig(examCode).misc.pyqNodeClassifyFraming,
    examCode,
    "misc.pyqNodeClassifyFraming",
  );
  return (
    `You map ${questions} to the single best-matching syllabus node. ` +
    "Choose ONLY from the provided paths. If none fit, return an empty path."
  );
}
