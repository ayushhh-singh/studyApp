import { useTranslation } from "react-i18next";
import { PenSquare } from "lucide-react";
import type { TestSummary } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TestCard } from "@/components/practice/test-card";
import { MainsCustomTestBuilder } from "@/components/answers/mains-custom-test-builder";
import { useTests } from "@/hooks/use-tests";
import { useLocale } from "@/hooks/use-locale";

/** Groups tests by their real exam year, descending — mirrors practice.tsx's groupByYearDescending. */
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

function MainsTestList({ kind }: { kind: "pyq_full" | "sectional" | "mock" | "custom" }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: tests, isLoading } = useTests({ kind, stage: "mains" });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
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

  const cards = (list: TestSummary[]) => (
    <ul className="flex flex-col gap-2">
      {list.map((test) => (
        <li key={test.id}>
          <TestCard test={test} locale={locale} href={`/${locale}/answers/session/${test.id}`} />
        </li>
      ))}
    </ul>
  );

  if (kind !== "pyq_full") return cards(tests);

  return (
    <div className="flex flex-col gap-4">
      {groupByYearDescending(tests).map(([year, yearTests]) => (
        <div key={year} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {year === "unknown" ? t("Practice.yearUnknown") : year}
          </h3>
          {cards(yearTests)}
        </div>
      ))}
    </div>
  );
}

const TABS = ["pyq_full", "sectional", "mock", "custom"] as const;
type Tab = (typeof TABS)[number];

export function AnswerTestTabs() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <SectionCard title={t("Answers.testTabsTitle")} description={t("Answers.testTabsDescription")}>
      <Tabs defaultValue={"pyq_full" satisfies Tab}>
        <TabsList>
          <TabsTrigger value="pyq_full">{t("Practice.tabPyq")}</TabsTrigger>
          <TabsTrigger value="sectional">{t("Practice.tabSectional")}</TabsTrigger>
          <TabsTrigger value="mock">{t("Practice.tabMock")}</TabsTrigger>
          <TabsTrigger value="custom">{t("Practice.tabCustom")}</TabsTrigger>
        </TabsList>
        <TabsContent value="pyq_full">
          <MainsTestList kind="pyq_full" />
        </TabsContent>
        <TabsContent value="sectional">
          <MainsTestList kind="sectional" />
        </TabsContent>
        <TabsContent value="mock">
          <MainsTestList kind="mock" />
        </TabsContent>
        <TabsContent value="custom">
          <div className="flex flex-col gap-4">
            <MainsCustomTestBuilder locale={locale} />
            <div className="border-t border-border pt-4">
              <h3 className="mb-2 text-sm font-semibold">{t("Practice.customYourSets")}</h3>
              <MainsTestList kind="custom" />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </SectionCard>
  );
}
