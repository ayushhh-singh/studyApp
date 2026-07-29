import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ExamPaper, ExamStructureStage } from "@neev/shared";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { useLocale } from "@/hooks/use-locale";

/** One paper of the current exam, flattened out of its stage block. */
export interface CatalogPaper extends ExamPaper {
  stage: ExamStructureStage;
  /** Non-null: a paper with no `paper_code` has no content and is filtered out. */
  paper_code: string;
  /** Position in the catalog's display order — the sort key every list should use. */
  rank: number;
}

const STAGE_RANK: Record<ExamStructureStage, number> = { prelims: 0, mains: 1, interview: 2 };

/**
 * The current exam's papers, ordered and labelled — the client-side replacement
 * for the hardcoded `PAPER_ORDER` / `MAINS_PAPER_ORDER` / `MOCK_PAPERS` arrays
 * and the `if (code === "PRE_GS1")` label ladders.
 *
 * ORDER: stage (prelims → mains), then marks descending, then the commission's
 * own `order`. Marks-before-order is a product rule, stated here once instead of
 * being re-encoded per component: the papers a candidate is scored most heavily
 * on lead every list. It reproduces today's UPPSC prelims order exactly
 * (GS-I, CSAT) and today's mains order except that General Hindi (150) now sits
 * beside Essay (150) in the commission's own sequence rather than after it.
 * Sorting by `order` alone would have put the two 150-mark language papers ahead
 * of all six 200-mark GS papers, flipping the Answers picker's default tab from
 * GS-I to General Hindi.
 *
 * LABELS: `Paper.<PAPER_CODE>` when a compact override exists, else the
 * registry's own `name_i18n`, else the raw code. Keying overrides by paper code
 * in one global namespace is safe precisely because paper codes are globally
 * unique across exams (migration 0106's load-bearing invariant), so a second
 * exam can add its own without collision — and needs none, since `name_i18n`
 * already carries a real bilingual name.
 *
 * An exam whose registry papers carry `paper_code: null` (every non-UPPSC exam
 * today — no syllabus ingested) yields an EMPTY catalog. Callers must render an
 * honest empty state; there is no borrowed UPPSC paper list to fall back to.
 *
 * ── CALLERS MUST GATE ON `isLoading`. THIS IS NOT OPTIONAL. ──────────────────
 * The catalog is EMPTY while `GET /exams` is in flight, and an empty catalog is
 * indistinguishable from "this exam has no papers" unless you check the flag.
 * Rendering through it produces one of two live regressions, both shipped once:
 *   - a paper code derived as `papers[0]?.paper_code ?? ""` disables the
 *     dependent query it is passed to, whose `isLoading:false` then renders as
 *     "no data" — a skeleton that never resolves. See lib/query-state.ts.
 *   - `compare` falls back to `localeCompare` of RAW CODES for papers it does
 *     not know yet, so a list renders in provisional alphabetical order
 *     (MAINS_ESSAY before MAINS_GS1) and visibly reshuffles a few seconds
 *     later — and an uncontrolled `defaultValue` tab keeps the wrong default.
 * Hold a loading state until this flag clears; do not render a provisional
 * order and do not render an empty state.
 */
export function usePaperCatalog(): {
  papers: CatalogPaper[];
  byCode: Map<string, CatalogPaper>;
  /** Compact display label for a paper code — safe for any code, including unknown ones. */
  label: (code: string | null | undefined) => string;
  /**
   * The paper's LATIN abbreviation in both locales ("GS-I", "CSAT") — see the
   * note on the returned implementation for why some surfaces want this rather
   * than {@link label}.
   */
  latinLabel: (code: string | null | undefined) => string;
  /** Sort comparator over paper codes, following the catalog order. */
  compare: (a: string | null | undefined, b: string | null | undefined) => number;
  /** True while `GET /exams` is in flight — see the gating rule above. */
  isLoading: boolean;
  /** The registry request FAILED. Distinct from an empty catalog; say so, don't render "absent". */
  isError: boolean;
} {
  const { exam, isLoading, isError } = useCurrentExam();
  const locale = useLocale();
  const { t } = useTranslation();

  const papers = useMemo<CatalogPaper[]>(() => {
    const flat = (exam?.paper_structure.stages ?? []).flatMap((block) =>
      (block.papers ?? [])
        .filter((p): p is ExamPaper & { paper_code: string } => !!p.paper_code)
        .map((p) => ({ ...p, stage: block.stage, rank: 0 })),
    );
    flat.sort(
      (a, b) =>
        STAGE_RANK[a.stage] - STAGE_RANK[b.stage] ||
        b.marks - a.marks ||
        a.order - b.order ||
        a.paper_code.localeCompare(b.paper_code),
    );
    return flat.map((p, i) => ({ ...p, rank: i }));
  }, [exam]);

  const byCode = useMemo(() => new Map(papers.map((p) => [p.paper_code, p])), [papers]);

  return useMemo(
    () => ({
      papers,
      byCode,
      label: (code) => {
        if (!code) return "—";
        // i18next returns the key itself when there is no translation, which is
        // how an un-overridden paper falls through to the registry's own name.
        const key = `Paper.${code}`;
        const override = t(key);
        if (override !== key) return override;
        return byCode.get(code)?.name_i18n[locale] ?? code;
      },
      // DELIBERATE PRODUCT DECISION, restored after the registry refactor
      // localized these and was caught in review: on the compact paper
      // SELECTORS (mock sub-tabs, scoreboard mock pills) the label stays the
      // latin abbreviation in BOTH locales — "GS-I" / "CSAT", never "जीएस-I" /
      // "सीसैट". That is how UPPSC aspirants actually refer to the papers, and
      // it matches the raw `paper_code` subtitle TestCard already shows beside
      // them. It is a paper's short NAME, not prose, so it does not translate.
      // Prose surfaces (an empty-state sentence, a cut-off card's copy) keep
      // using `label` and stay localized — the split is intentional.
      // Reads the `en` bundle explicitly rather than the active locale; both
      // bundles are preloaded in lib/i18n.ts, so this is synchronous.
      latinLabel: (code) => {
        if (!code) return "—";
        const key = `Paper.${code}`;
        const override = t(key, { lng: "en" });
        if (override !== key) return override;
        return byCode.get(code)?.name_i18n.en ?? code;
      },
      compare: (a, b) => {
        const ra = a ? (byCode.get(a)?.rank ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const rb = b ? (byCode.get(b)?.rank ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        // Codes the registry doesn't know keep a stable order among themselves
        // rather than jumping around: fall back to the code's own ordering.
        if (ra === rb) return (a ?? "").localeCompare(b ?? "");
        return ra - rb;
      },
      isLoading,
      isError,
    }),
    [papers, byCode, locale, t, isLoading, isError],
  );
}
