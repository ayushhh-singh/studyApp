/**
 * Booklet-series detection for UPPSC prelims papers + answer keys.
 *
 * UPPSC prints each prelims Question Booklet in one of four series (A/B/C/D)
 * with the SAME questions in a SHUFFLED order, and publishes the official answer
 * key per series. So a q_no→answer map from a Series-A key is WRONG for a
 * Series-B paper. We can't remap between series (that needs the per-series
 * question permutation, which UPPSC never publishes), so the pragmatic rule is:
 * trust the key's q_no map ONLY when the paper's series and the key's series
 * agree (or one is genuinely unknown, in which case the Session-27 blind
 * re-solve gate is the backstop that catches a mis-keyed answer anyway).
 *
 * Detection reads the cover page (page 1), where any series marker is printed in
 * Latin/digit form and so survives the legacy-font mojibake that garbles the
 * Hindi body text.
 *
 * REALITY (confirmed on the 2024 GS-I pilot): a clean A/B/C/D letter is often
 * ABSENT. Original UPPSC booklets encode the set as a CODE string (e.g.
 * "DSTF-1-23") + a bar-code serial, NOT a plain letter; and coaching-
 * RECONSTRUCTED papers (Drishti/Vision, common on the open web) print no series
 * marker at all. So `detectBookletSeries` returns null far more often than not,
 * `seriesAlignment` degrades to "assumed", and the blind re-solve gate becomes
 * the actual proof that a key's answers line up with a paper's ordering
 * (content agreement), rather than a letter-equality check that usually can't
 * run. The letter, when present, is still captured for transparency.
 */
import { structuredJson, MODELS } from "../lib/anthropic.js";
import { pdfSubsetDocumentBlock } from "./_shared.js";

export type BookletSeries = "A" | "B" | "C" | "D";

const SERIES_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    series: { type: "string", enum: ["A", "B", "C", "D", "unknown"] },
    evidence: { type: "string" },
  },
  required: ["series", "evidence"],
};

const SERIES_SYSTEM =
  "You are shown the cover/first page of a UPPSC exam question paper or its official answer key. Look for a BOOKLET " +
  "SERIES / SET letter (A, B, C, or D) printed near the top or in a box, and report that letter EXACTLY as printed. " +
  "Note: many UPPSC booklets carry only a CODE string (e.g. 'DSTF-1-23') or a bar-code serial number instead of a " +
  "plain A/B/C/D letter, and coaching-reconstructed papers may print no series marker at all — in those cases there " +
  "is no series letter, so return 'unknown'. Quote the exact printed phrase you used as evidence. Return strict JSON only.";

/**
 * Detect the booklet series printed on a PDF's first page (and, for a key, an
 * extra page in case the label is on page 2). Returns null when unknown so the
 * caller can fall back to the blind-resolve backstop rather than a wrong guess.
 */
export async function detectBookletSeries(
  fileAbsPath: string,
  pageCount: number,
  purpose = "ingest_series_detect",
): Promise<BookletSeries | null> {
  const pages = pageCount > 1 ? [0, 1] : [0];
  try {
    const out = await structuredJson<{ series: string; evidence: string }>({
      model: MODELS.haiku,
      maxTokens: 200,
      system: SERIES_SYSTEM,
      content: [
        await pdfSubsetDocumentBlock(fileAbsPath, pages),
        { type: "text", text: "Which booklet series is this?" },
      ],
      schema: SERIES_SCHEMA,
      purpose,
    });
    const s = (out.series ?? "").trim().toUpperCase();
    return s === "A" || s === "B" || s === "C" || s === "D" ? s : null;
  } catch {
    // Detection is best-effort; an error just means "unknown" (blind-resolve backstop).
    return null;
  }
}

export type SeriesAlignment = "aligned" | "mismatch" | "assumed";

/**
 * How much to trust a key's q_no→answer map for a paper, given both detected
 * series. "aligned" (equal) → trust; "mismatch" (both known, differ) → do NOT
 * trust the key (route to blind-resolve); "assumed" (one unknown) → trust the
 * q_no map but flag it, since blind-resolve will catch a real error.
 */
export function seriesAlignment(
  paperSeries: BookletSeries | null,
  keySeries: BookletSeries | null,
): SeriesAlignment {
  if (paperSeries && keySeries) return paperSeries === keySeries ? "aligned" : "mismatch";
  return "assumed";
}
