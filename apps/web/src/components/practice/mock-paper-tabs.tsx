import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PenSquare } from "lucide-react";
import type { Locale, TestSummary } from "@neev/shared";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { TestCard } from "@/components/practice/test-card";
import { useTests } from "@/hooks/use-tests";
import { useLocale } from "@/hooks/use-locale";

/** Canonical paper order for the mock sub-tabs: prelims papers, then mains GS1-6. */
const PAPER_ORDER = [
  "PRE_GS1",
  "PRE_CSAT",
  "MAINS_GS1",
  "MAINS_GS2",
  "MAINS_GS3",
  "MAINS_GS4",
  "MAINS_GS5",
  "MAINS_GS6",
];

/**
 * Compact, exam-standard paper label for a tab (GS-I / CSAT / GS1..GS6). Kept as
 * the latin abbreviation in both locales — the same convention TestCard already
 * uses for the raw paper_code subtitle, and how UPPSC aspirants refer to the papers.
 */
function paperLabel(code: string | null): string {
  if (code === "PRE_GS1") return "GS-I";
  if (code === "PRE_CSAT") return "CSAT";
  const m = code?.match(/^MAINS_GS(\d)$/);
  if (m) return `GS${m[1]}`;
  return code ?? "—";
}

/** Numeric mock index from the slug (`mock:PRE_GS1:3` → 3), for 1→N sequencing. */
function mockIndex(test: TestSummary): number {
  const n = Number(test.slug?.split(":").pop());
  return Number.isFinite(n) ? n : 0;
}

function MockList({
  tests,
  locale,
  hrefFor,
}: {
  tests: TestSummary[];
  locale: Locale;
  hrefFor?: (test: TestSummary) => string;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {tests.map((test) => (
        <li key={test.id}>
          <TestCard test={test} locale={locale} href={hrefFor?.(test)} />
        </li>
      ))}
    </ul>
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
  const byPaper = useMemo(() => {
    const groups = new Map<string, TestSummary[]>();
    for (const t of tests) {
      const code = t.paper_code ?? "—";
      (groups.get(code) ?? groups.set(code, []).get(code)!).push(t);
    }
    for (const list of groups.values()) list.sort((a, b) => mockIndex(a) - mockIndex(b));
    return [...groups.entries()].sort(([a], [b]) => {
      const ia = PAPER_ORDER.indexOf(a);
      const ib = PAPER_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [tests]);

  if (byPaper.length === 0) return null;
  // A single paper needs no selector — just the sequenced list.
  if (byPaper.length === 1) return <MockList tests={byPaper[0][1]} locale={locale} hrefFor={hrefFor} />;

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
          <MockList tests={list} locale={locale} hrefFor={hrefFor} />
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
