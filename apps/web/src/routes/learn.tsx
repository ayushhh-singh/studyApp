import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, BookOpen, FileText, Library, ListChecks, SlidersHorizontal, Target } from "lucide-react";
import type { PaperSummary } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { StatCardSkeleton } from "@/components/ui-x/skeleton";
import { Chip } from "@/components/ui-x/chip";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandTextColor } from "@/lib/score-band";

export const handle = { titleKey: "Nav.learn" };

/**
 * Browse surface for the syllabus: a stage filter and a card grid.
 *
 * ⚑ THIS PAGE DELIBERATELY HAS NO FREE-TEXT SEARCH BOX. It used to, and the box
 * could only ever match the TEN paper titles this grid renders — while the
 * command palette (Ctrl/Cmd+K) searches the real corpus behind them: syllabus
 * topics, PYQs, chapters, personal notes and current affairs. Two boxes on one
 * screen, one of which silently searches ~10 rows and the other ~14,000, is a
 * trap rather than a convenience: a user who types "inflation" here gets "no
 * papers match" and reasonably concludes the app has nothing on inflation.
 * Search is centralised in the palette; this page filters. Do not add it back.
 *
 * The stage filter stays because it is STRUCTURED filtering of the list that is
 * actually on screen, which is a different job from search and belongs next to
 * the list it narrows. It sits inline rather than in the old collapsible rail —
 * a whole disclosure panel existed to house three controls, and one chip row
 * does not need one.
 */

type StageFilter = "all" | "prelims" | "mains";
type SortKey = "syllabus" | "pyqs" | "coverage" | "accuracy";

const STAGE_FILTERS: StageFilter[] = ["all", "prelims", "mains"];
const SORT_KEYS: SortKey[] = ["syllabus", "pyqs", "coverage", "accuracy"];

function coveragePct(paper: PaperSummary) {
  return paper.topics_count > 0
    ? Math.min(100, Math.round((paper.notes_published_count / paper.topics_count) * 100))
    : 0;
}

function PaperCard({ paper }: { paper: PaperSummary }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const pct = coveragePct(paper);

  return (
    <Link
      to={`/${locale}/learn/${paper.paper_code}`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <BookOpen className="size-5" aria-hidden />
        </span>
        {paper.accuracy_pct !== null && (
          <span
            className="shrink-0 font-display text-sm font-bold tabular-nums"
            style={{ color: scoreBandTextColor(paper.accuracy_pct) }}
          >
            {Math.round(paper.accuracy_pct)}%
          </span>
        )}
      </div>
      <div>
        <span className="block text-sm font-semibold text-balance">{paper.title_i18n[locale]}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {t(`Learn.${paper.exam_stage}`)}
        </span>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-action transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
            {t("Learn.notesCoverage", { pct })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{t("Learn.topicsCount", { count: paper.topics_count })}</span>
          <span className="flex items-center gap-1">
            <ListChecks className="size-3.5" aria-hidden />
            {t("Learn.pyqCount", { count: paper.pyq_count })}
          </span>
        </div>
      </div>
    </Link>
  );
}

export function Component() {
  const { t } = useTranslation();
  const { name: examName } = useCurrentExam();
  const locale = useLocale();
  const { data, isLoading, isError, refetch } = usePaperSummaries();
  // The commission's own paper order, for the "Syllabus order" sort.
  const { compare, isLoading: catalogLoading } = usePaperCatalog();
  const [params, setParams] = useSearchParams();

  // Filters live in the URL — a filtered browse is shareable and survives a
  // back/forward, the same convention the rest of the app follows for tabs and
  // filters. Unknown/absent values fall back to the permissive default rather
  // than rendering an empty grid for a typo'd URL.
  const stage = (STAGE_FILTERS.find((s) => s === params.get("stage")) ?? "all") as StageFilter;
  const sort = (SORT_KEYS.find((s) => s === params.get("sort")) ?? "syllabus") as SortKey;

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const papers = useMemo(() => {
    if (!data) return [];
    const filtered = data.filter((p) => stage === "all" || p.exam_stage === stage);
    const sorted = [...filtered];
    if (sort === "pyqs") sorted.sort((a, b) => b.pyq_count - a.pyq_count);
    else if (sort === "coverage") sorted.sort((a, b) => coveragePct(b) - coveragePct(a));
    else if (sort === "accuracy") {
      // Papers you've never attempted have no accuracy to rank — they sort
      // last rather than being treated as 0%, which would read as "you scored
      // zero here" when the truth is "you haven't started".
      sorted.sort((a, b) => (b.accuracy_pct ?? -1) - (a.accuracy_pct ?? -1));
    } else {
      // ⚑ "Syllabus order" USED TO DO NOTHING — there was no branch here at all,
      // so the list kept whatever order the API happened to return. That order is
      // `getPaperSummaries`' `.order("paper_code")`, i.e. ALPHABETICAL BY CODE,
      // which is not syllabus order and visibly is not: UPSC_PRE_CSAT sorts
      // before UPSC_PRE_GS1 because "C" < "G", so the papers grid opened with
      // Paper II above Paper I under a control that said "Syllabus order".
      //
      // The registry IS the syllabus order — `exams.paper_structure` was seeded
      // from each commission's own notification PDF (0106), so `compare` follows
      // the order the commission itself prints. It also fixes Mains, where
      // alphabetical put MAINS_ESSAY and MAINS_GH ahead of MAINS_GS1.
      sorted.sort((a, b) => compare(a.paper_code, b.paper_code));
    }
    return sorted;
  }, [data, stage, sort, compare]);

  const totalCount = data?.length ?? 0;
  // The catalog is EMPTY while `GET /exams` is in flight and `compare` then falls
  // back to comparing RAW CODES — which is exactly the alphabetical order this
  // fix exists to remove. Rendering through it would show the wrong order for a
  // moment and visibly reshuffle, so hold the skeleton until it resolves; this is
  // the gating rule `usePaperCatalog`'s own header calls not optional.
  const showSkeleton = isLoading || (sort === "syllabus" && catalogLoading);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Learn.title")} description={t("Learn.description", { exam: examName })} tourAnchor="learn" />

      {/* Free base texts, beside the syllabus they support. This is where a
          reader working through a paper actually wants NCERT — not in Profile,
          where it first landed only because /resources had no in-app home.
          Unconditional: it needs no data, so it is useful on day one. */}
      <div className="flex flex-wrap gap-2">
        <Link
          to={`/${locale}/learn/resources`}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Library className="size-4 shrink-0 text-marigold-foreground" aria-hidden />
          {t("Learn.resourcesLinkCta")}
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </Link>
      </div>

      {!showSkeleton && totalCount > 0 && (
        <Link
          to={`/${locale}/profile#mastery-matrix`}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Target className="size-4 shrink-0 text-primary" aria-hidden />
          {t("Learn.matrixLinkCta")}
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </Link>
      )}

      {/* A FAILED fetch must not read as "still loading" (skeletons forever)
          or as "this exam has no syllabus". `!data` alone collapses all three
          — the class QueryErrorState exists for, and one this page is now
          MORE likely to hit: the landing page added two public API calls that
          share the same per-IP limiter (docs/OUTSTANDING.md B9). */}
      {isError ? (
        <QueryErrorState onRetry={() => void refetch()} />
      ) : showSkeleton || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : totalCount === 0 ? (
        <EmptyState icon={BookOpen} title={t("Learn.emptyTitle")} description={t("Learn.emptyDescription")} />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Stage chips + sort on one wrapping row. `gap-y` matters more than
              `gap-x` here: at 390px the sort control wraps below the chips, and
              without vertical gap the two rows touch. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div role="group" aria-label={t("Learn.filterStage")} className="flex flex-wrap gap-2">
              {STAGE_FILTERS.map((opt) => (
                <Chip
                  key={opt}
                  active={stage === opt}
                  onClick={() => setParam("stage", opt, "all")}
                  // Chip's own 44px min-height is kept deliberately. The old
                  // rail shrank its chips to 36px, but those were secondary
                  // "remove this filter" affordances; these are now the page's
                  // PRIMARY control, and 36px is under the design system's tap
                  // floor. (This was the only min-h-9 Chip in the app.)
                  className="px-3 text-xs"
                >
                  {t(`Learn.stage_${opt}`)}
                </Chip>
              ))}
            </div>
            <div className="ms-auto flex items-center gap-2">
              <label
                htmlFor="learn-sort"
                className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
                {t("Learn.sortBy")}
              </label>
              <select
                id="learn-sort"
                value={sort}
                onChange={(e) => setParam("sort", e.target.value, "syllabus")}
                // 44px, matching the chips beside it and the select this
                // replaced — the rail's original sort control was h-11.
                className="min-h-11 rounded-xl border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {SORT_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {t(`Learn.sort_${k}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p aria-live="polite" className="text-xs text-muted-foreground">
            {t("Learn.paperCount", { count: papers.length })}
          </p>

          {papers.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={t("Learn.noMatchTitle")}
              description={t("Learn.noMatchDescription")}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {papers.map((paper) => (
                <PaperCard key={paper.paper_code} paper={paper} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
