import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { PenSquare, Sparkles } from "lucide-react";
import type { Locale, TestSummary } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { TestCard } from "@/components/practice/test-card";
import { useTests } from "@/hooks/use-tests";
import { useCreateFreshMockSet } from "@/hooks/use-create-fresh-set";
import { useLocale } from "@/hooks/use-locale";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";

/** Numeric mock index from the slug (`mock:PRE_GS1:3` → 3), for 1→N sequencing. */
function mockIndex(test: TestSummary): number {
  const n = Number(test.slug?.split(":").pop());
  return Number.isFinite(n) ? n : 0;
}

/**
 * "Fresh mock" — a full-length UPPSC-pattern paper built on demand from
 * questions this user hasn't recently seen (a SELECTION against the demand-aware
 * reserve, never a live generation call). Mocks are Pro-only, so a Free user's
 * click surfaces the paywall error the server returns.
 */
function FreshMockButton({
  paperCode,
  locale,
  hrefFor,
}: {
  paperCode: string;
  locale: Locale;
  hrefFor?: (test: TestSummary) => string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fresh = useCreateFreshMockSet();
  const [preparing, setPreparing] = useState(false);

  function onClick() {
    setPreparing(false);
    fresh.mutate(
      { paper_code: paperCode },
      {
        onSuccess: (result) => {
          if (result.status === "ready") {
            navigate(hrefFor ? hrefFor(result.test) : `/${locale}/practice/test/${result.test.id}`);
          } else {
            setPreparing(true);
          }
        },
      },
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        type="button"
        variant="outline"
        onClick={onClick}
        disabled={fresh.isPending}
        className="self-start"
        title={t("OnDemand.hint")}
      >
        <Sparkles className="size-4" /> {fresh.isPending ? t("OnDemand.finding") : t("OnDemand.newMock")}
      </Button>
      {fresh.isError && <p className="text-sm text-destructive">{fresh.error.message}</p>}
      {preparing && (
        <div className="flex items-start gap-2 rounded-lg border border-marigold/30 bg-marigold/15 px-3 py-2 text-sm text-marigold-foreground">
          <Sparkles className="mt-0.5 size-4 shrink-0 text-marigold" />
          <span>{t("OnDemand.preparingMock")}</span>
        </div>
      )}
    </div>
  );
}

function MockList({
  tests,
  locale,
  hrefFor,
  paperCode,
}: {
  tests: TestSummary[];
  locale: Locale;
  hrefFor?: (test: TestSummary) => string;
  paperCode: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <FreshMockButton paperCode={paperCode} locale={locale} hrefFor={hrefFor} />
      <ul className="flex flex-col gap-2">
        {tests.map((test) => (
          <li key={test.id}>
            <TestCard test={test} locale={locale} href={hrefFor?.(test)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Groups mock tests by paper into sub-tabs (GS-I / CSAT for prelims, GS1-6 for
 * mains) and lists each paper's sets in sequence (Mock Test 1 → N), instead of
 * one flat created_at-descending list.
 */
export function MockPaperTabs({
  tests,
  locale,
  hrefFor,
}: {
  tests: TestSummary[];
  locale: Locale;
  /** Overrides the TestCard link — mains descriptive mocks start a timed answer session, not the MCQ player. */
  hrefFor?: (test: TestSummary) => string;
}) {
  // Order and labels come from the exam's own registry entry, not a hardcoded
  // paper-code list — see usePaperCatalog. A paper the registry doesn't know
  // (an exam mid-ingest) still gets a tab, sorted last under its raw code.
  const { label: paperLabel, compare } = usePaperCatalog();
  const byPaper = useMemo(() => {
    const groups = new Map<string, TestSummary[]>();
    for (const t of tests) {
      const code = t.paper_code ?? "—";
      (groups.get(code) ?? groups.set(code, []).get(code)!).push(t);
    }
    for (const list of groups.values()) list.sort((a, b) => mockIndex(a) - mockIndex(b));
    return [...groups.entries()].sort(([a], [b]) => compare(a, b));
  }, [tests, compare]);

  if (byPaper.length === 0) return null;
  // A single paper needs no selector — just the sequenced list.
  if (byPaper.length === 1)
    return <MockList tests={byPaper[0][1]} locale={locale} hrefFor={hrefFor} paperCode={byPaper[0][0]} />;

  return (
    <Tabs defaultValue={byPaper[0][0]}>
      <TabsList>
        {byPaper.map(([code]) => (
          <TabsTrigger key={code} value={code}>
            {paperLabel(code)}
          </TabsTrigger>
        ))}
      </TabsList>
      {byPaper.map(([code, list]) => (
        <TabsContent key={code} value={code}>
          <MockList tests={list} locale={locale} hrefFor={hrefFor} paperCode={code} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** Self-contained mock panel: fetches the stage's mocks and renders the paper sub-tabs. */
export function MockTestsPanel({
  stage,
  hrefFor,
}: {
  stage: "prelims" | "mains";
  hrefFor?: (test: TestSummary) => string;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data: tests, isLoading } = useTests({ kind: "mock", stage });

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
    return <EmptyState icon={PenSquare} title={t("Practice.emptyTitle")} description={t("Practice.emptyDescription")} />;
  }
  return <MockPaperTabs tests={tests} locale={locale} hrefFor={hrefFor} />;
}
