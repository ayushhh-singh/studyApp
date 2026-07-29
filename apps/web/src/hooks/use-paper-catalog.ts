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
 */
export function usePaperCatalog(): {
  papers: CatalogPaper[];
  byCode: Map<string, CatalogPaper>;
  /** Compact display label for a paper code — safe for any code, including unknown ones. */
  label: (code: string | null | undefined) => string;
  /** Sort comparator over paper codes, following the catalog order. */
  compare: (a: string | null | undefined, b: string | null | undefined) => number;
  isLoading: boolean;
} {
  const { exam, isLoading } = useCurrentExam();
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
      compare: (a, b) => {
        const ra = a ? (byCode.get(a)?.rank ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        const rb = b ? (byCode.get(b)?.rank ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
        // Codes the registry doesn't know keep a stable order among themselves
        // rather than jumping around: fall back to the code's own ordering.
        if (ra === rb) return (a ?? "").localeCompare(b ?? "");
        return ra - rb;
      },
      isLoading,
    }),
    [papers, byCode, locale, t, isLoading],
  );
}
