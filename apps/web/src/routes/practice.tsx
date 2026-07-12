import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { PenSquare, Timer, Trophy, X, Zap } from "lucide-react";
import type { ExamCode, TestSummary } from "@prayasup/shared";
import { examCodeSchema } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { ExamFilter } from "@/components/ui-x/exam-filter";
import { FirstVisitCoachmark } from "@/components/ui-x/first-visit-coachmark";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PyqList } from "@/components/learn/pyq-list";
import { TestCard } from "@/components/practice/test-card";
import { CustomTestBuilder } from "@/components/practice/custom-test-builder";
import { DailyQuizPanel } from "@/components/practice/daily-quiz-panel";
import { AttemptHistoryList } from "@/components/practice/attempt-history-list";
import { useTests } from "@/hooks/use-tests";
import { useSyllabusNode } from "@/hooks/use-syllabus-node";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Nav.practice" };

const TABS = ["daily", "pyq", "sectional", "mock", "timeattack", "custom", "history"] as const;
type Tab = (typeof TABS)[number];

function isTab(value: string | null): value is Tab {
  return !!value && (TABS as readonly string[]).includes(value);
}

function PyqFilterView({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const examParam = examCodeSchema.safeParse(searchParams.get("exam"));
  const exam: ExamCode | undefined = examParam.success ? examParam.data : undefined;
  const { data: node } = useSyllabusNode(nodeId, exam);
  const page = Number(searchParams.get("page") ?? "1") || 1;

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

  function setExam(next: ExamCode | undefined) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set("exam", next);
        else params.delete("exam");
        params.delete("page");
        return params;
      },
      { replace: true },
    );
  }

  return (
    <SectionCard
      title={node ? t("Practice.filteredTitle", { topic: node.title_i18n[locale] }) : t("Practice.filteredTitleFallback")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <ExamFilter value={exam} onChange={setExam} />
          <Button asChild variant="ghost" size="sm">
            <Link to={`/${locale}/practice`}>
              <X aria-hidden />
              {t("Practice.clearFilter")}
            </Link>
          </Button>
        </div>
      }
    >
      <PyqList nodeId={nodeId} locale={locale} page={page} onPageChange={setPage} exam={exam} />
    </SectionCard>
  );
}

/** Groups tests by their real exam year, descending; a missing year (shouldn't happen for pyq_full, kept safe anyway) sorts last. */
function groupByYearDescending(tests: TestSummary[]): [string, TestSummary[]][] {
  const groups = new Map<string, TestSummary[]>();
  for (const test of tests) {
    const key = test.year != null ? String(test.year) : "unknown";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(test);
  }
  return [...groups.entries()].sort(([a], [b]) => {
    if (a === "unknown") return 1;
    if (b === "unknown") return -1;
    return Number(b) - Number(a);
  });
}

function TestListPanel({ kind }: { kind: "pyq_full" | "sectional" | "mock" }) {
  const { t } = useTranslation();
  const locale = useLocale();
  // Explicit stage, not just relying on listTests' historical default —
  // that default only ever covered pyq_full/sectional; "mock" had no such
  // guard (Mains mocks didn't exist until they did), and Mains mock tests
  // started leaking into this MCQ-only tab the moment they were built.
  const { data: tests, isLoading } = useTests({ kind, stage: "prelims" });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  if (!tests || tests.length === 0) {
    return (
      <EmptyState icon={PenSquare} title={t("Practice.emptyTitle")} description={t("Practice.emptyDescription")} />
    );
  }

  // pyq_full tests are real per-year full papers — group them under a year
  // heading so "attempt the whole 2024 paper" is one obvious click instead of
  // a flat, unordered list. Sectional pools across years by design and mock
  // has no year at all, so both stay flat.
  if (kind !== "pyq_full") {
    return (
      <ul className="flex flex-col gap-2">
        {tests.map((test) => (
          <li key={test.id}>
            <TestCard test={test} locale={locale} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groupByYearDescending(tests).map(([year, yearTests]) => (
        <div key={year} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {year === "unknown" ? t("Practice.yearUnknown") : year}
          </h3>
          <ul className="flex flex-col gap-2">
            {yearTests.map((test) => (
              <li key={test.id}>
                <TestCard test={test} locale={locale} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function CustomTestsPanel() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: tests, isLoading } = useTests({ kind: "custom", stage: "prelims" });

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title={t("Practice.customBuilderTitle")}>
        <CustomTestBuilder locale={locale} />
      </SectionCard>
      <SectionCard title={t("Practice.customYourSets")}>
        {isLoading ? (
          <ListRowSkeleton />
        ) : !tests || tests.length === 0 ? (
          <EmptyState icon={PenSquare} title={t("Practice.customEmptyTitle")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {tests.map((test) => (
              <li key={test.id}>
                <TestCard test={test} locale={locale} />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

function TimeAttackPanel() {
  const { t } = useTranslation();
  const locale = useLocale();
  return (
    <div className="flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-5 shadow-sm">
      <span className="flex size-12 items-center justify-center rounded-xl bg-marigold/15 text-marigold">
        <Zap className="size-6" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h3 className="text-lg font-semibold">{t("TimeAttack.title")}</h3>
        <p className="max-w-prose text-sm text-muted-foreground">{t("TimeAttack.pitch")}</p>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Timer className="size-4 text-primary" aria-hidden />
          {t("TimeAttack.chipTimer")}
        </span>
        <span className="flex items-center gap-1.5">
          <Trophy className="size-4 text-marigold" aria-hidden />
          {t("TimeAttack.chipBest")}
        </span>
      </div>
      <Button asChild>
        <Link to={`/${locale}/practice/time-attack`}>
          <Zap aria-hidden />
          {t("TimeAttack.enter")}
        </Link>
      </Button>
    </div>
  );
}

export function Component() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const nodeFilter = searchParams.get("node");
  const tab: Tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "pyq";
  const dailyTabRef = useRef<HTMLButtonElement>(null);

  if (nodeFilter) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("Practice.title")} description={t("Practice.description")} />
        <PyqFilterView nodeId={nodeFilter} />
      </div>
    );
  }

  function setTab(next: Tab) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "pyq") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Practice.title")} description={t("Practice.description")} />

      <FirstVisitCoachmark
        sectionKey="practice"
        targetRef={dailyTabRef}
        message={t("Explore.coachmarkPractice")}
        dismissLabel={t("Explore.coachmarkGotIt")}
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger ref={dailyTabRef} value="daily">{t("Practice.tabDaily")}</TabsTrigger>
          <TabsTrigger value="pyq">{t("Practice.tabPyq")}</TabsTrigger>
          <TabsTrigger value="sectional">{t("Practice.tabSectional")}</TabsTrigger>
          <TabsTrigger value="mock">{t("Practice.tabMock")}</TabsTrigger>
          <TabsTrigger value="timeattack">{t("Practice.tabTimeAttack")}</TabsTrigger>
          <TabsTrigger value="custom">{t("Practice.tabCustom")}</TabsTrigger>
          <TabsTrigger value="history">{t("Practice.tabHistory")}</TabsTrigger>
        </TabsList>
        <TabsContent value="daily">
          <SectionCard title={t("Practice.dailyArchiveTitle")} description={t("Practice.dailyArchiveDescription")}>
            <DailyQuizPanel />
          </SectionCard>
        </TabsContent>
        <TabsContent value="pyq">
          <SectionCard title={t("Practice.available")}>
            <TestListPanel kind="pyq_full" />
          </SectionCard>
        </TabsContent>
        <TabsContent value="sectional">
          <SectionCard title={t("Practice.available")}>
            <TestListPanel kind="sectional" />
          </SectionCard>
        </TabsContent>
        <TabsContent value="mock">
          <SectionCard title={t("Practice.mockTitle")} description={t("Practice.mockDescription")}>
            <TestListPanel kind="mock" />
          </SectionCard>
        </TabsContent>
        <TabsContent value="timeattack">
          <TimeAttackPanel />
        </TabsContent>
        <TabsContent value="custom">
          <CustomTestsPanel />
        </TabsContent>
        <TabsContent value="history">
          <SectionCard title={t("Practice.historyTitle")}>
            <AttemptHistoryList />
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
