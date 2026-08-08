import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Archive, BarChart3, FileQuestion, Flame } from "lucide-react";
import type { ExamCode, Locale, Question, TrendNode } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { ExamYearChip } from "@/components/ui-x/exam-chip";
import { PaginationControls } from "@/components/ui-x/pagination-controls";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { RecentThenArchive } from "@/components/ui-x/recent-then-archive";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportQuestionSheet } from "@/components/questions/report-question-sheet";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { useExams } from "@/hooks/use-exams";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";
import { usePaperTrends } from "@/hooks/use-paper-tree";
import { useQuestions } from "@/hooks/use-questions";
import { useLocale } from "@/hooks/use-locale";
import { useArchiveExpanded } from "@/lib/archive-view";
import { formatQuestionStem } from "@/lib/format-question-stem";
import { groupByYearDescending } from "@/lib/group-by-year";
import { isAwaitingData } from "@/lib/query-state";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "PyqArchive.title" };

/** Search param owned by this page's recent/archive toggle. */
const ARCHIVE_PARAM = "view";

/**
 * Answer-key honesty badge — NEW to this page, deliberately separate from
 * `ExamYearChip`. Renders unconditionally for a descriptive (Mains) question
 * (this exam's commission publishes no Mains answer key, ever — that must
 * never be silently omitted, only ever stated), and switches on the MCQ's
 * real `key_provenance` for a prelims-style question.
 */
function ProvenanceBadge({ question }: { question: Question }) {
  const { t } = useTranslation();

  if (question.type === "descriptive") {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {t("PyqArchive.provenanceDescriptive")}
      </span>
    );
  }

  if (question.key_provenance === "official_commission") {
    return (
      <span className="inline-flex items-center rounded-md bg-tulsi/15 px-2 py-0.5 text-xs font-medium text-tulsi-foreground">
        {t("PyqArchive.provenanceOfficial")}
      </span>
    );
  }
  if (question.key_provenance === "coaching_reproduced") {
    return (
      <span className="inline-flex items-center rounded-md bg-marigold/15 px-2 py-0.5 text-xs font-medium text-marigold-foreground">
        {t("PyqArchive.provenanceCoaching")}
      </span>
    );
  }
  // key_provenance === "none" or null (legacy row) — never inferred, always the
  // honest "we don't have a verified key for this one" state.
  return (
    <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {t("PyqArchive.provenanceNone")}
    </span>
  );
}

/**
 * A self-contained question card for this page — structurally modelled on
 * `components/learn/pyq-list.tsx`'s `QuestionCard` (same bilingual-stem +
 * options + marks/word-limit + explanation-toggle shape) but NOT that
 * component: this page adds the provenance badge and has no "referenced
 * question" highlight/scroll concept, so it's kept independent rather than
 * bolting archive-only props onto the shared PYQ list.
 */
function ArchiveQuestionCard({ question, locale }: { question: Question; locale: Locale }) {
  const { t } = useTranslation();
  const [showExplanation, setShowExplanation] = useState(false);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <ExamYearChip
          examCode={question.exam_code}
          examLabel={question.exam_label_i18n}
          outOfSyllabus={question.out_of_syllabus}
        />
        <ProvenanceBadge question={question} />
        <ReportQuestionSheet
          questionId={question.id}
          className="ml-auto flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <p className="text-sm whitespace-pre-line">{formatQuestionStem(question.stem_i18n[locale])}</p>
      {question.options_i18n && (
        <ul className="flex flex-col gap-1 text-xs">
          {question.options_i18n.map((option) => (
            <li
              key={option.key}
              className={cn(
                "flex gap-1.5",
                option.key === question.correct_option_key
                  ? "font-semibold text-tulsi"
                  : "text-muted-foreground",
              )}
            >
              <span>{option.key}.</span>
              <span>{option.text_i18n[locale]}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        {question.marks != null && <span>{t("Learn.marks", { count: question.marks })}</span>}
        {question.word_limit != null && <span>{t("Learn.wordLimit", { count: question.word_limit })}</span>}
        {question.explanation_i18n && (
          <button
            type="button"
            onClick={() => setShowExplanation((v) => !v)}
            className="rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {showExplanation ? t("Learn.hideExplanation") : t("Learn.showExplanation")}
          </button>
        )}
      </div>
      {showExplanation && question.explanation_i18n && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/50 p-2.5 text-xs">
          <p>
            <span className="font-semibold text-foreground">EN — </span>
            {question.explanation_i18n.en}
          </p>
          <p lang="hi" className="leading-[1.75]">
            <span className="font-semibold text-foreground">HI — </span>
            {question.explanation_i18n.hi}
          </p>
        </div>
      )}
    </li>
  );
}

/** Replicates learn-trends.tsx's TrendRow (not imported — it isn't exported). */
function WeightageRow({ node, max, locale }: { node: TrendNode; max: number; locale: Locale }) {
  const { t } = useTranslation();
  const width = max > 0 ? Math.max(6, Math.round((node.total / max) * 100)) : 0;
  const hot = node.hotness >= 60;
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm">{node.title_i18n[locale]}</span>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
          {hot && <Flame className="size-3 text-coral" aria-hidden />}
          {t("Learn.askedTimes", { count: node.total })}
          {node.last_asked_year != null && (
            <span className="opacity-70">· {t("Learn.lastAsked", { year: node.last_asked_year })}</span>
          )}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </li>
  );
}

function WeightageList({ nodes, locale }: { nodes: TrendNode[]; locale: Locale }) {
  const max = nodes.reduce((m, n) => Math.max(m, n.total), 0);
  return (
    <ul className="flex flex-col gap-2">
      {nodes.map((node) => (
        <WeightageRow key={node.node_id} node={node} max={max} locale={locale} />
      ))}
    </ul>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { examCode, name: examName } = useCurrentExam();
  const { papers, byCode, latinLabel, isLoading: catalogLoading, isError: catalogError } = usePaperCatalog();
  // Same cache entry usePaperCatalog()/useCurrentExam() already read (queryKeys.exams()),
  // so this costs no extra request — it's here only for `refetch` on a genuine failure.
  const { refetch: refetchExams } = useExams();
  const [searchParams, setSearchParams] = useSearchParams();

  const paperParam = searchParams.get("paper");
  const fallbackPaperCode = papers[0]?.paper_code;
  // Default to the first paper in catalog order — never a hardcoded code, so
  // this works unchanged for whichever exam the signed-in user prepares for.
  const selectedPaperCode = paperParam && byCode.has(paperParam) ? paperParam : fallbackPaperCode;

  const yearParam = searchParams.get("year");
  const parsedYear = yearParam ? Number(yearParam) : NaN;
  const selectedYear = Number.isFinite(parsedYear) ? parsedYear : undefined;

  const page = Number(searchParams.get("page") ?? "1") || 1;
  const expanded = useArchiveExpanded(ARCHIVE_PARAM);

  // Hooks are called unconditionally (Rules of Hooks) even while the paper
  // catalog is still loading and `selectedPaperCode` is undefined — both
  // hooks already gate on `!!paperCode` internally (usePaperTree.ts), so this
  // mirrors learn-trends.tsx's own pattern rather than reinventing it.
  const trendsQuery = usePaperTrends(selectedPaperCode, examCode as ExamCode);

  // "Recent" for a PYQ bank is the newest EXAM YEAR, not a row count: past
  // papers arrive one sitting at a time, so the unit a student thinks in is
  // "what did they ask last year", never "the last 5 questions".
  const yearsDescending = [...(trendsQuery.data?.years ?? [])].sort((a, b) => b - a);
  const latestYear = yearsDescending[0];
  const oldestYear = yearsDescending[yearsDescending.length - 1];

  // Collapsed: pinned to the newest year. Expanded: whatever the year picker
  // says, `undefined` meaning every year.
  const effectiveYear = expanded ? selectedYear : latestYear;
  const questionsQuery = useQuestions({
    paper: selectedPaperCode,
    year: effectiveYear,
    exam: examCode as ExamCode,
    page,
    // The collapsed view's year is DERIVED from the trends query. Without this
    // gate the first render would fire an all-years request that is thrown away
    // the moment trends resolves — a wasted round trip that can also paint
    // before the real one lands, briefly showing years the heading denies.
    //
    // Gated on trends no longer PENDING rather than on `latestYear != null`:
    // a paper whose trends resolve with no years at all would leave the latter
    // permanently false, and a permanently-disabled query reports
    // `isLoading: false` with no data — the stranded-skeleton bug documented in
    // lib/query-state.ts. This way that paper falls through to a real
    // (all-years, and therefore empty) request and an honest empty state.
    enabled: expanded || !trendsQuery.isPending,
  });

  function setPaper(next: string) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("paper", next);
        params.delete("year");
        params.delete("page");
        return params;
      },
      { replace: true },
    );
  }

  function setYear(next: number | undefined) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next != null) params.set("year", String(next));
        else params.delete("year");
        params.delete("page");
        return params;
      },
      { replace: true },
    );
  }

  function setPage(next: number) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next > 1) params.set("page", String(next));
        else params.delete("page");
        return params;
      },
      { replace: true },
    );
  }

  // usePaperCatalog's own doc comment: callers MUST gate on isLoading before
  // reading an empty catalog as "this exam has no papers" — a disabled
  // dependent query would otherwise report isLoading:false and strand a
  // permanent skeleton (see lib/query-state.ts).
  if (catalogLoading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("PyqArchive.title")} description={t("PyqArchive.description", { exam: examName })} />
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      </div>
    );
  }

  // A genuinely failed registry fetch must render as a failure, not as "this
  // exam has no papers" — the two read identically (papers.length === 0)
  // unless isError is checked separately (usePaperCatalog's own doc comment;
  // see QueryErrorState's docstring for the exact prior incidents this caused
  // elsewhere in the app).
  if (catalogError) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("PyqArchive.title")} description={t("PyqArchive.description", { exam: examName })} />
        <QueryErrorState onRetry={() => refetchExams()} />
      </div>
    );
  }

  if (papers.length === 0 || !selectedPaperCode) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("PyqArchive.title")} description={t("PyqArchive.description", { exam: examName })} />
        <EmptyState
          icon={Archive}
          title={t("PyqArchive.noPapersTitle")}
          description={t("PyqArchive.noPapersDescription")}
        />
      </div>
    );
  }

  // From here on `selectedPaperCode` is narrowed to `string` by the guard above.
  const awaitingBody = isAwaitingData(trendsQuery, questionsQuery);
  const groups = questionsQuery.data ? groupByYearDescending(questionsQuery.data.items) : [];

  const questionList = awaitingBody ? (
    <div className="flex flex-col gap-2">
      <ListRowSkeleton />
      <ListRowSkeleton />
    </div>
  ) : questionsQuery.isError ? (
    <QueryErrorState onRetry={() => questionsQuery.refetch()} />
  ) : !questionsQuery.data || questionsQuery.data.items.length === 0 ? (
    <EmptyState icon={FileQuestion} title={t("PyqArchive.emptyTitle")} description={t("PyqArchive.emptyDescription")} />
  ) : (
    <div className="flex flex-col gap-4">
      {groups.map(([year, questions]) => (
        <div key={year} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {year === "unknown" ? t("Learn.yearUnknown") : year}
          </h3>
          <ul className="flex flex-col gap-2">
            {questions.map((question) => (
              <ArchiveQuestionCard key={question.id} question={question} locale={locale} />
            ))}
          </ul>
        </div>
      ))}
      <PaginationControls
        page={page}
        totalPages={questionsQuery.data.pagination.total_pages}
        onPageChange={setPage}
        labels={{
          previous: t("Learn.prevPage"),
          next: t("Learn.nextPage"),
          pageOf: t("Learn.pageOf", { page, total: questionsQuery.data.pagination.total_pages }),
        }}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("PyqArchive.title")} description={t("PyqArchive.description", { exam: examName })} />

      <Tabs value={selectedPaperCode} onValueChange={(v) => setPaper(v)}>
        <TabsList>
          {papers.map((paper) => (
            <TabsTrigger key={paper.paper_code} value={paper.paper_code}>
              {latinLabel(paper.paper_code)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <SectionCard
        title={t("PyqArchive.questionsTitle")}
        description={
          // The recent view is scoped to one year and says so in words; without
          // this, a paper's newest year silently reads as its whole bank.
          expanded || latestYear == null ? undefined : t("PyqArchive.latestYearDescription", { year: latestYear })
        }
        action={
          // The year picker belongs to the ARCHIVE view only — offering it
          // beside a list that is pinned to the latest year would let a student
          // pick 2019 and see nothing change, or silently turn the "recent"
          // view into something that is not recent.
          expanded ? (
            <div className="flex items-center gap-2">
              <label htmlFor="pyq-archive-year" className="text-xs font-medium text-muted-foreground">
                {t("PyqArchive.yearFilterLabel")}
              </label>
              <select
                id="pyq-archive-year"
                className="min-h-11 max-w-[10rem] rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedYear ?? ""}
                onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)}
              >
                <option value="">{t("PyqArchive.allYears")}</option>
                {yearsDescending.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          ) : undefined
        }
      >
        {/* A paper with one year (or none) has nothing to browse INTO: pinning
            to the latest year already shows all of it, so a "Browse all years"
            leading to the same list would be a lie — the same reason History
            hides "See all" when page 1 is the whole history. */}
        {yearsDescending.length <= 1 ? (
          questionList
        ) : (
          /* Both views render the SAME list — deliberately. Unlike the other
             two surfaces, what changes here is not the markup but the query
             behind it (pinned to the latest year vs. the year picker's choice)
             and whether that picker is offered at all. It still goes through
             RecentThenArchive so the toggle, its URL state and its shape match
             Practice → Daily and → History rather than being a bespoke button. */
          <RecentThenArchive
            param={ARCHIVE_PARAM}
            expandLabel={t("PyqArchive.browseAllYearsRange", { from: oldestYear, to: latestYear })}
            collapseLabel={t("PyqArchive.backToLatest", { year: latestYear })}
            recent={questionList}
            archive={questionList}
          />
        )}
      </SectionCard>

      <SectionCard title={t("PyqArchive.weightageTitle")}>
        {awaitingBody ? (
          <ListRowSkeleton />
        ) : trendsQuery.isError ? (
          <QueryErrorState onRetry={() => trendsQuery.refetch()} />
        ) : !trendsQuery.data || trendsQuery.data.top_nodes.length === 0 ? (
          <EmptyState icon={BarChart3} title={t("Trends.emptyTitle")} description={t("Trends.emptyDescription")} />
        ) : (
          <WeightageList nodes={trendsQuery.data.top_nodes} locale={locale} />
        )}
      </SectionCard>
    </div>
  );
}
