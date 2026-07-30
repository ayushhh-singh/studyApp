/**
 * Data-file contract for the HAND-AUTHORED UPSC syllabus tree.
 *
 * WHY HAND-AUTHORED, and why this is a separate pipeline from `ingest:syllabus`
 * ---------------------------------------------------------------------------
 * `apps/api/src/ingest/syllabus.ts` cannot serve a second exam, for three
 * independently fatal reasons (do not re-litigate them):
 *   1. `loadLangSource` hardcodes the manifest ids `uppsc_syllabus_2026_${lang}` /
 *      `uppsc_syllabus_drishti_${lang}` — it physically cannot load a UPSC PDF.
 *   2. It LLM-INVENTS the tree (`structuredJson`, sonnet, effort high). A
 *      generated tree can never pass a verbatim official-text coverage gate.
 *   3. `buildStructurePaperSystem` and `fillBilingual` both call
 *      `requireAuthored(getExamConfig(exam)...)`, which THROWS for `upsc` by
 *      design — its config slots are deliberately UNAUTHORED (see
 *      `lib/exam-config.ts` and docs/OUTSTANDING.md §8f "U6").
 *
 * So the UPSC tree is authored by hand against the official notification text
 * and loaded by a DETERMINISTIC, ZERO-LLM loader (`upsc-syllabus-seed.ts`),
 * gated by a verbatim-coverage verifier (`verify-coverage.ts`). No Anthropic or
 * OpenAI call is made anywhere in this directory.
 *
 * The two data modules that implement these types (`upsc-official-lines.ts`,
 * `upsc-syllabus-tree.ts`) are authored by other agents; this file is the
 * contract they write against and the loader reads.
 */

/** One verbatim line of official syllabus text, as printed in the source document. */
export interface OfficialSyllabusLine {
  /** Stable id, e.g. "GS1-L03", "P2-L01", "GS4-L12". */
  id: string;
  paperCode: string;
  /** VERBATIM official text. Never paraphrased. */
  text: string;
  /** Which source document + locator this line was read from. */
  source: string;
}

export interface SeedNode {
  paperCode: string;
  /** kebab-case, slash-separated, unique within the paper. No leading/trailing slash. */
  path: string;
  title: { en: string; hi: string };
  description: { en: string; hi: string } | null;
  orderIndex: number;
  /** Official line ids this node covers. Leaves MUST be non-empty. */
  officialLines: string[];
  /**
   * Provenance of this node's SCOPE:
   *  - "official_line": the title/scope is official text — a whole syllabus line,
   *    or a verbatim clause within one (e.g. a semicolon-separated part).
   *  - "editorial_subdivision": the node subdivides an official line's named
   *    scope into a conventional study unit whose title is NOT a phrase in the
   *    official text (e.g. official "History of India and Indian National
   *    Movement." -> "Ancient India"). Mirrors the UPPSC tree's own broad-leaf
   *    Prelims convention. Requires `subdivisionRationale`.
   *
   * WHY THIS FIELD EXISTS: UPSC Prelims has only 7 official bullets (Paper I)
   * and 6 (Paper II), while the UPPSC `PRE_GS1` tree we must mirror for grain
   * has 31 nodes with deliberately broad leaves. Matching that grain means
   * subdividing one official bullet into several conventional study units, so
   * "no invented topics" CANNOT mean "every title is a literal official
   * phrase". It means: every node traces to >=1 official line, AND every node
   * that is not literal official text is explicitly DECLARED and listed for
   * audit. Both derivations pass the reverse (nothing-invented) check; the
   * distinction is what makes the coverage artifact honest.
   */
  derivation: "official_line" | "editorial_subdivision";
  /** REQUIRED iff derivation === "editorial_subdivision". Why this split is a faithful decomposition and not an addition. */
  subdivisionRationale?: string;
  /** Set only where the official text is genuinely ambiguous — surfaced in the report, never silently resolved. */
  ambiguityNote?: string;
}
