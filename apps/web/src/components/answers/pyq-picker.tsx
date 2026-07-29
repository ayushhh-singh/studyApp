import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ChevronRight, NotebookPen } from "lucide-react";
import type { Locale, Question } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAllQuestions } from "@/hooks/use-questions";
import { usePaperSummaries } from "@/hooks/use-paper-summaries";
import { useLocale } from "@/hooks/use-locale";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { groupByYearDescending } from "@/lib/group-by-year";
import { cn } from "@/lib/utils";

/** Years beyond the most recent this many stay collapsed on first render, to keep it short. */
const DEFAULT_EXPANDED_YEARS = 2;
/** A single paper+year group reveals this many questions before offering "show more". */
const YEAR_SHOW_STEP = 30;

function YearGroup({
  year,
  questions,
  isOpenByDefault,
  locale,
}: {
  year: string;
  questions: Question[];
  isOpenByDefault: boolean;
  locale: Locale;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(isOpenByDefault);
  const [revealed, setRevealed] = useState(YEAR_SHOW_STEP);
  const shown = questions.slice(0, revealed);
  const remaining = questions.length - shown.length;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {year === "unknown" ? t("Answers.pyqPickerYearUnknown") : year}{" "}
          <span className="font-normal normal-case text-muted-foreground/70">
            {t("Answers.totalCount", { count: questions.length })}
          </span>
        </span>
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
      </button>
      {open && (
        <>
          <ul className="flex flex-col gap-2">
            {shown.map((question) => (
              <li key={question.id}>
                <Link
                  to={`/${locale}/answers/write?question=${question.id}`}
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <p className="text-sm whitespace-pre-line" lang={locale}>
                    {formatQuestionStem(question.stem_i18n[locale])}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{question.paper_code}</span>
                    {question.marks !== null && <span>{t("Answers.marks", { count: question.marks })}</span>}
                    {question.word_limit !== null && (
                      <span>{t("Answers.wordLimit", { count: question.word_limit })}</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setRevealed((v) => v + YEAR_SHOW_STEP)}
              className="self-start text-xs font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("Answers.pyqPickerShowMore", { count: remaining })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function PaperPyqList({ paperCode, paperLabel, locale }: { paperCode: string; paperLabel: string; locale: Locale }) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useAllQuestions({ type: "descriptive", paper: paperCode });
  const yearGroups = useMemo(() => (data ? groupByYearDescending(data.items) : []), [data]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }
  if (isError) {
    return <QueryErrorState onRetry={() => refetch()} />;
  }
  if (yearGroups.length === 0) {
    // Some papers (Essay, General Hindi, or any paper mid-ingestion) genuinely
    // have thinner coverage than others — say so per-paper rather than a
    // generic "no questions" that reads like the whole feature is broken.
    return (
      <EmptyState
        icon={NotebookPen}
        title={t("Answers.emptyTitle")}
        description={t("Answers.pyqPickerThinCoverage", { paper: paperLabel })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {yearGroups.map(([year, questions], index) => (
        <YearGroup
          key={year}
          year={year}
          questions={questions}
          isOpenByDefault={index < DEFAULT_EXPANDED_YEARS}
          locale={locale}
        />
      ))}
    </div>
  );
}

export function PyqPicker() {
  const { t } = useTranslation();
  const locale = useLocale();
  const {
    data: allPapers,
    isLoading: papersLoading,
    isError: papersError,
    refetch: refetchPapers,
  } = usePaperSummaries();

  // Paper order and the compact tab labels come from the exam registry — the
  // previous hardcoded MAINS_PAPER_ORDER array and inline bilingual label
  // dictionary were both UPPSC paper codes, and the dictionary bypassed i18n
  // entirely. See usePaperCatalog.
  const { label: paperLabel, compare } = usePaperCatalog();
  const papers = useMemo(() => {
    // Answer Writing is Mains-only (descriptive PYQs) — Prelims papers are
    // entirely MCQ, so listing them here just leads to a real, confusingly
    // empty "no PYQs" state once picked. Mirrors the inverse filter already
    // used by the MCQ custom-test-builder (Prelims-only there).
    const mains = (allPapers ?? []).filter((p) => p.exam_stage !== "prelims");
    return [...mains].sort((a, b) => compare(a.paper_code, b.paper_code));
  }, [allPapers, compare]);

  const [activePaper, setActivePaper] = useState("");
  const paper =
    activePaper && papers.some((p) => p.paper_code === activePaper) ? activePaper : (papers[0]?.paper_code ?? "");

  return (
    <SectionCard title={t("Answers.pyqPickerTitle")} description={t("Answers.pyqPickerDescription")}>
      {/* data-tour-anchor="answers" (also on the real tab strip below) needs to
          exist in SOME form in every branch — if the guided tab tour lands on
          this stop while paperSummaries is still loading or has errored, an
          anchor that only exists once tabs render would strand that step with
          no spotlight and no visible Next/Skip, since GuidedTourCoachmark only
          renders once it finds a matching element. */}
      {papersLoading ? (
        <div data-tour-anchor="answers" className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : papersError ? (
        <div data-tour-anchor="answers">
          <QueryErrorState onRetry={() => refetchPapers()} />
        </div>
      ) : papers.length === 0 ? (
        <div data-tour-anchor="answers">
          <EmptyState icon={NotebookPen} title={t("Answers.emptyTitle")} description={t("Answers.emptyDescription")} />
        </div>
      ) : (
        <Tabs value={paper} onValueChange={setActivePaper}>
          {/* Guided-tab-tour "answers" stop spotlights this tab strip specifically — see GuidedTourCoachmark. */}
          <div data-tour-anchor="answers">
            <TabsList aria-label={t("Answers.pyqPickerPaperFilter")}>
              {papers.map((p) => {
                const label = paperLabel(p.paper_code);
                return (
                  <TabsTrigger
                    key={p.paper_code}
                    value={p.paper_code}
                    className="gap-1.5"
                    aria-label={`${label} — ${t("Answers.totalCount", { count: p.pyq_count })}`}
                  >
                    <span aria-hidden="true">{label}</span>
                    <span
                      aria-hidden="true"
                      className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted-foreground/15 px-1 text-[10px] font-semibold tabular-nums"
                    >
                      {p.pyq_count}
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>
          <TabsContent value={paper}>
            {/* key={paper}: forces a clean remount per paper — otherwise a
                YearGroup keyed only by its "2024"-style year string gets
                REUSED across a tab switch whenever two papers share a year
                (true for nearly every Mains paper pair, since they all span
                the same ~2018-2025 range), silently carrying over its
                expand/collapse + "show more" state from the previous paper. */}
            <PaperPyqList
              key={paper}
              paperCode={paper}
              paperLabel={paperLabel(paper)}
              locale={locale}
            />
          </TabsContent>
        </Tabs>
      )}
    </SectionCard>
  );
}
