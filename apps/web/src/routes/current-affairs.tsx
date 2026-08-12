import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Newspaper, BookMarked, ScanLine } from "lucide-react";
import type { CurrentAffairsCategory, CurrentAffairsItem, CurrentAffairsLens } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { CurrentAffairsItemCard } from "@/components/current-affairs/item-card";
import { CurrentAffairsDetailSheet } from "@/components/current-affairs/item-detail-sheet";
import { CurrentAffairsQuizSets } from "@/components/current-affairs/quiz-button";
import { QuickScanFeed } from "@/components/current-affairs/quick-scan-feed";
import { useCurrentAffairs } from "@/hooks/use-current-affairs";
import { useCurrentExam } from "@/hooks/use-current-exam";
import { useLocale } from "@/hooks/use-locale";
import { stateFocusCode } from "@/lib/exam-label";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.currentAffairs" };

/**
 * `up` is the STATE lens and is offered only to an exam that has one
 * (`exam.state_lens !== null`). Server-side it now filters on `state_focus`
 * — this exam's OWN state code (M20b) rather than the raw `is_up_specific`
 * flag, which is whichever commission triaged the shared row. The server
 * returns no such filter for a nationally-scoped exam; this is the half that
 * stops the tab existing at all, so the user never sees an empty phantom tab.
 */
const LENSES: CurrentAffairsLens[] = ["all", "prelims", "mains", "up"];
const STATE_LENSES = new Set<CurrentAffairsLens>(["up"]);
const LENS_LABEL: Record<CurrentAffairsLens, string> = {
  all: "CurrentAffairs.lensAll",
  prelims: "CurrentAffairs.lensPrelims",
  mains: "CurrentAffairs.lensMains",
  up: "CurrentAffairs.lensUp",
};

/** Same rule as STATE_LENSES, for the category chips: `up_special` is a state category. */
const STATE_CATEGORIES = new Set<CurrentAffairsCategory>(["up_special"]);

const CATEGORIES: CurrentAffairsCategory[] = [
  "polity_governance",
  "economy",
  "international_relations",
  "environment_ecology",
  "science_tech",
  "security",
  "social_issues",
  "art_culture",
  "schemes",
  "reports_indices",
  "places_persons",
  "up_special",
];

function istToday(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function groupByDateDescending(items: CurrentAffairsItem[]): [string, CurrentAffairsItem[]][] {
  const byDate = new Map<string, CurrentAffairsItem[]>();
  for (const item of items) {
    const bucket = byDate.get(item.date) ?? [];
    bucket.push(item);
    byDate.set(item.date, bucket);
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? 1 : -1));
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();

  const { exam, examCode, isLoading: examLoading } = useCurrentExam();
  // While the registry is still loading `exam` is null, which is NOT "this exam
  // has no state lens" — assume it has one until we know, so the tab never
  // flickers away and back for the live (state-scoped) exam.
  const hasStateLens = examLoading || exam === null || exam.state_lens !== null;
  const lenses = LENSES.filter((l) => hasStateLens || !STATE_LENSES.has(l));
  const categories = CATEGORIES.filter((c) => hasStateLens || !STATE_CATEGORIES.has(c));
  // Short code ("UP"), not the full state name — this must read the same as
  // the "up_special" category chip right below it (both hardcoded "UP
  // Special" pre-fix; using the full name here alone would visibly disagree
  // with that chip on the same page). Only ever actually rendered (via the
  // "up" lens tab) when hasStateLens is true, so this resolves to a real
  // value by the time it's on screen.
  const stateCode = stateFocusCode(exam, examCode);

  const rawLens = (searchParams.get("lens") as CurrentAffairsLens | null) ?? "all";
  // A stale `?lens=up` survives an exam switch. Rather than erroring or leaving a
  // phantom tab selected, fall back to "all" — matching the server, which drops
  // the filter for the same reason.
  const lens = lenses.includes(rawLens) ? rawLens : "all";
  const rawCategory = (searchParams.get("cat") as CurrentAffairsCategory | null) ?? "";
  const category = rawCategory === "" || categories.includes(rawCategory) ? rawCategory : "";
  const page = Number(searchParams.get("page")) || 1;
  const scan = searchParams.get("scan") === "1";
  const selectedId = searchParams.get("item");

  function patchParams(patch: Record<string, string | null>) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") params.delete(k);
          else params.set(k, v);
        }
        return params;
      },
      { replace: true },
    );
  }

  const { data, isLoading, isError, refetch } = useCurrentAffairs({
    lens: lens === "all" ? undefined : lens,
    category: category || undefined,
    page,
  });

  const today = istToday();
  const yesterday = new Date(new Date(today).getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);

  function dateLabel(date: string): string {
    if (date === today) return t("CurrentAffairs.today");
    if (date === yesterday) return t("CurrentAffairs.yesterday");
    return new Date(date).toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short" });
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("CurrentAffairs.title")}
        description={t("CurrentAffairs.description")}
        tourAnchor="current_affairs"
        action={
          <Link
            to={`/${locale}/magazine`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookMarked className="size-4" /> {t("Magazine.navTitle")}
          </Link>
        }
      />

      <SectionCard title={t("CurrentAffairs.practiceSetsTitle")}>
        <CurrentAffairsQuizSets />
      </SectionCard>

      <SectionCard title={t("CurrentAffairs.latest")}>
        {/* Exam-lens tabs */}
        <div className="flex w-full items-center gap-1 overflow-x-auto scrollbar-hide rounded-lg bg-muted p-1">
          {lenses.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lens === l}
              onClick={() => patchParams({ lens: l === "all" ? null : l, page: null })}
              className={cn(
                "h-8 flex-1 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                lens === l ? "bg-background text-foreground shadow-xs" : "text-muted-foreground",
              )}
            >
              {t(LENS_LABEL[l], { code: stateCode ?? "" })}
            </button>
          ))}
        </div>

        {/* Category chips + (Prelims tab) quick-scan toggle */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => patchParams({ cat: null, page: null })}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              category === "" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent",
            )}
          >
            {t("CurrentAffairs.filterAllCategories")}
          </button>
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => patchParams({ cat: c, page: null })}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                category === c ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {t(`CurrentAffairs.category.${c}`)}
            </button>
          ))}
        </div>

        {lens === "prelims" && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{scan ? t("CurrentAffairs.quickScanHint") : ""}</p>
            <Button
              type="button"
              variant={scan ? "default" : "outline"}
              size="sm"
              aria-pressed={scan}
              onClick={() => patchParams({ scan: scan ? null : "1" })}
            >
              <ScanLine className="size-4" aria-hidden /> {t("CurrentAffairs.quickScan")}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : isError ? (
          <QueryErrorState onRetry={() => refetch()} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title={t("CurrentAffairs.emptyTitle")}
            description={t("CurrentAffairs.emptyDescription")}
          />
        ) : lens === "prelims" && scan ? (
          <QuickScanFeed items={data.items} locale={locale} onSelect={(id) => patchParams({ item: id })} />
        ) : (
          <div className="flex flex-col gap-4">
            {groupByDateDescending(data.items).map(([date, items]) => (
              <div key={date} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {dateLabel(date)}
                </h3>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <CurrentAffairsItemCard
                      key={item.id}
                      item={item}
                      locale={locale}
                      stateCode={stateCode}
                      onSelect={(id) => patchParams({ item: id })}
                    />
                  ))}
                </ul>
              </div>
            ))}

            {data.pagination.total_pages > 1 && (
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => patchParams({ page: String(page - 1) })}
                >
                  {t("Learn.prevPage")}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {t("Learn.pageOf", { page, total: data.pagination.total_pages })}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= data.pagination.total_pages}
                  onClick={() => patchParams({ page: String(page + 1) })}
                >
                  {t("Learn.nextPage")}
                </Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      <CurrentAffairsDetailSheet
        itemId={selectedId}
        locale={locale}
        stateCode={stateCode}
        onOpenChange={(open) => !open && patchParams({ item: null })}
      />
    </div>
  );
}
