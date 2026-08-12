import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { BookOpen, FileText, ListChecks, Target, ArrowRight, Search, X, SlidersHorizontal } from "lucide-react";
import type { PaperSummary } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { StatCardSkeleton } from "@/components/ui-x/skeleton";
import { Chip } from "@/components/ui-x/chip";
import { Input } from "@/components/ui/input";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { useLocale } from "@/hooks/use-locale";
import { scoreBandTextColor } from "@/lib/score-band";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.learn" };

/**
 * Browse surface for the syllabus, rebuilt to docs/design/reference-1's
 * COURSES page: search + a filter rail + a card grid.
 *
 * The mockup's filters are a placeholder catalogue ("UPSC / State PCS /
 * Optional / Foundation" as sibling checkboxes, an Enrolled/Completed status,
 * a bookmark on every card). None of that maps onto this app: a user prepares
 * for exactly ONE exam at a time (`users_profile.target_exam`), so a
 * cross-exam category filter would be a control with one legal value, and
 * there is no enrolment, no completion flag and no paper bookmark to read.
 *
 * So the visual pattern is reproduced against the fields that DO exist:
 * category → the paper's exam STAGE, status → whether this user has actually
 * answered anything in it, and the card's progress bar → real published
 * chapter coverage. Nothing here invents a parallel course catalog.
 */

type StageFilter = "all" | "prelims" | "mains";
type StatusFilter = "all" | "started" | "not_started";
type SortKey = "syllabus" | "pyqs" | "coverage" | "accuracy";

const STAGE_FILTERS: StageFilter[] = ["all", "prelims", "mains"];
const STATUS_FILTERS: StatusFilter[] = ["all", "started", "not_started"];
const SORT_KEYS: SortKey[] = ["syllabus", "pyqs", "coverage", "accuracy"];

/** "Has this user actually done anything here" — the only real progress signal a paper carries. */
function isStarted(paper: PaperSummary) {
  return paper.answered_count > 0;
}

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
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
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

/** Radio-style filter group — the reference's checkbox rail, as single-select rows. */
function FilterGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  optionLabel,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (next: T) => void;
  optionLabel: (opt: T) => string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</legend>
      {options.map((opt) => (
        <label
          key={opt}
          className="flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-1 text-sm transition-colors hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
        >
          <input
            type="radio"
            name={label}
            checked={value === opt}
            onChange={() => onChange(opt)}
            className="size-4 accent-[var(--action)] outline-none"
          />
          <span className={cn(value === opt ? "font-semibold text-foreground" : "text-muted-foreground")}>
            {optionLabel(opt)}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function Component() {
  const { t } = useTranslation();
  const { name: examName } = useCurrentExam();
  const locale = useLocale();
  const { data, isLoading } = usePaperSummaries();
  const [params, setParams] = useSearchParams();

  // Filters live in the URL — a filtered browse is shareable and survives a
  // back/forward, the same convention the rest of the app follows for tabs and
  // filters. Unknown/absent values fall back to the permissive default rather
  // than rendering an empty grid for a typo'd URL.
  const stage = (STAGE_FILTERS.find((s) => s === params.get("stage")) ?? "all") as StageFilter;
  const status = (STATUS_FILTERS.find((s) => s === params.get("status")) ?? "all") as StatusFilter;
  const sort = (SORT_KEYS.find((s) => s === params.get("sort")) ?? "syllabus") as SortKey;
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  const papers = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLocaleLowerCase(locale === "hi" ? "hi-IN" : "en-IN");
    const filtered = data.filter((p) => {
      if (stage !== "all" && p.exam_stage !== stage) return false;
      if (status === "started" && !isStarted(p)) return false;
      if (status === "not_started" && isStarted(p)) return false;
      if (!q) return true;
      // Search both locales' titles plus the paper code: an aspirant may well
      // type "GS1" or the English name while reading the Hindi UI.
      return (
        p.title_i18n.en.toLocaleLowerCase("en-IN").includes(q) ||
        p.title_i18n.hi.toLocaleLowerCase("hi-IN").includes(q) ||
        p.paper_code.toLocaleLowerCase("en-IN").includes(q)
      );
    });
    const sorted = [...filtered];
    if (sort === "pyqs") sorted.sort((a, b) => b.pyq_count - a.pyq_count);
    else if (sort === "coverage") sorted.sort((a, b) => coveragePct(b) - coveragePct(a));
    else if (sort === "accuracy") {
      // Papers you've never attempted have no accuracy to rank — they sort
      // last rather than being treated as 0%, which would read as "you scored
      // zero here" when the truth is "you haven't started".
      sorted.sort((a, b) => (b.accuracy_pct ?? -1) - (a.accuracy_pct ?? -1));
    }
    return sorted;
  }, [data, stage, status, sort, query, locale]);

  const totalCount = data?.length ?? 0;

  const filterRail = (
    <div className="flex flex-col gap-6">
      <FilterGroup
        label={t("Learn.filterStage")}
        options={STAGE_FILTERS}
        value={stage}
        onChange={(v) => setParam("stage", v, "all")}
        optionLabel={(o) => t(`Learn.stage_${o}`)}
      />
      <FilterGroup
        label={t("Learn.filterStatus")}
        options={STATUS_FILTERS}
        value={status}
        onChange={(v) => setParam("status", v, "all")}
        optionLabel={(o) => t(`Learn.status_${o}`)}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="learn-sort" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t("Learn.sortBy")}
        </label>
        <select
          id="learn-sort"
          value={sort}
          onChange={(e) => setParam("sort", e.target.value, "syllabus")}
          className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {SORT_KEYS.map((k) => (
            <option key={k} value={k}>
              {t(`Learn.sort_${k}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Learn.title")} description={t("Learn.description", { exam: examName })} tourAnchor="learn" />

      {!isLoading && totalCount > 0 && (
        <Link
          to={`/${locale}/profile#mastery-matrix`}
          className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Target className="size-4 shrink-0 text-primary" aria-hidden />
          {t("Learn.matrixLinkCta")}
          <ArrowRight className="size-3.5 shrink-0" aria-hidden />
        </Link>
      )}

      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      ) : totalCount === 0 ? (
        <EmptyState icon={BookOpen} title={t("Learn.emptyTitle")} description={t("Learn.emptyDescription")} />
      ) : (
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
          {/* Filter rail — a fixed column on desktop, a disclosure above the
              grid at 390px (the reference's own mobile sheet, without a second
              overlay layer to trap focus in). */}
          <aside className="lg:w-56 lg:shrink-0">
            <h2 className="hidden text-base font-semibold lg:mb-4 lg:block">{t("Learn.filtersTitle")}</h2>
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-controls="learn-filters"
              className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="size-4" aria-hidden />
                {t("Learn.filtersTitle")}
              </span>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t("Learn.paperCount", { count: papers.length })}
              </span>
            </button>
            <div
              id="learn-filters"
              className={cn(
                "mt-4 rounded-xl border border-border bg-card p-4 lg:mt-0 lg:block lg:border-0 lg:bg-transparent lg:p-0",
                filtersOpen ? "block" : "hidden",
              )}
            >
              {filterRail}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="relative">
              <Search
                className="pointer-events-none absolute start-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("Learn.searchPlaceholder")}
                aria-label={t("Learn.searchPlaceholder")}
                className="ps-10 pe-10"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label={t("Common.clear")}
                  className="absolute end-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>

            {/* Active-filter chips double as the "clear this" control. */}
            {(stage !== "all" || status !== "all") && (
              <div className="flex flex-wrap items-center gap-2">
                {stage !== "all" && (
                  <Chip active onClick={() => setParam("stage", "all", "all")} className="min-h-9 gap-1.5 px-3 text-xs">
                    {t(`Learn.stage_${stage}`)}
                    <X className="size-3.5" aria-hidden />
                  </Chip>
                )}
                {status !== "all" && (
                  <Chip active onClick={() => setParam("status", "all", "all")} className="min-h-9 gap-1.5 px-3 text-xs">
                    {t(`Learn.status_${status}`)}
                    <X className="size-3.5" aria-hidden />
                  </Chip>
                )}
              </div>
            )}

            <p aria-live="polite" className="text-xs text-muted-foreground">
              {t("Learn.paperCount", { count: papers.length })}
            </p>

            {papers.length === 0 ? (
              <EmptyState
                icon={Search}
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
        </div>
      )}
    </div>
  );
}
