import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { PenSquare, X } from "lucide-react";
import type { ExamCode } from "@prayasup/shared";
import { examCodeSchema } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { ExamFilter } from "@/components/ui-x/exam-filter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PyqList } from "@/components/learn/pyq-list";
import { TestCard } from "@/components/practice/test-card";
import { CustomTestBuilder } from "@/components/practice/custom-test-builder";
import { DailyQuizPanel } from "@/components/practice/daily-quiz-panel";
import { useTests } from "@/hooks/use-tests";
import { useSyllabusNode } from "@/hooks/use-syllabus-node";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "Nav.practice" };

const TABS = ["daily", "pyq", "sectional", "custom"] as const;
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

function TestListPanel({ kind }: { kind: "pyq_full" | "sectional" }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: tests, isLoading } = useTests({ kind });

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

function CustomTestsPanel() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: tests, isLoading } = useTests({ kind: "custom" });

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

export function Component() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const nodeFilter = searchParams.get("node");
  const tab: Tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "pyq";

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

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList>
          <TabsTrigger value="daily">{t("Practice.tabDaily")}</TabsTrigger>
          <TabsTrigger value="pyq">{t("Practice.tabPyq")}</TabsTrigger>
          <TabsTrigger value="sectional">{t("Practice.tabSectional")}</TabsTrigger>
          <TabsTrigger value="custom">{t("Practice.tabCustom")}</TabsTrigger>
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
        <TabsContent value="custom">
          <CustomTestsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
