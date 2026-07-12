import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Newspaper, BookMarked, ScanLine } from "lucide-react";
import type { CurrentAffairsCategory, CurrentAffairsItem, CurrentAffairsLens } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { FirstVisitCoachmark } from "@/components/ui-x/first-visit-coachmark";
import { CurrentAffairsItemCard } from "@/components/current-affairs/item-card";
import { CurrentAffairsDetailSheet } from "@/components/current-affairs/item-detail-sheet";
import { CurrentAffairsWeeklyQuizButtons } from "@/components/current-affairs/quiz-button";
import { QuickScanFeed } from "@/components/current-affairs/quick-scan-feed";
import { useCurrentAffairs } from "@/hooks/use-current-affairs";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.currentAffairs" };

const LENSES: CurrentAffairsLens[] = ["all", "prelims", "mains", "up"];
const LENS_LABEL: Record<CurrentAffairsLens, string> = {
  all: "CurrentAffairs.lensAll",
  prelims: "CurrentAffairs.lensPrelims",
  mains: "CurrentAffairs.lensMains",
  up: "CurrentAffairs.lensUp",
};

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

  const lens = (searchParams.get("lens") as CurrentAffairsLens | null) ?? "all";
  const category = (searchParams.get("cat") as CurrentAffairsCategory | null) ?? "";
  const page = Number(searchParams.get("page")) || 1;
  const scan = searchParams.get("scan") === "1";
  const selectedId = searchParams.get("item");
  const lensTabsRef = useRef<HTMLDivElement>(null);

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
        action={
          <Link
            to={`/${locale}/magazine/${istToday().slice(0, 7)}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookMarked className="size-4" /> {t("Magazine.navTitle")}
          </Link>
        }
      />

      <SectionCard title={t("CurrentAffairs.weeklySetsTitle")}>
        <CurrentAffairsWeeklyQuizButtons />
      </SectionCard>

      <SectionCard title={t("CurrentAffairs.latest")}>
        <FirstVisitCoachmark
          sectionKey="current_affairs"
          targetRef={lensTabsRef}
          message={t("Explore.coachmarkCurrentAffairs")}
          dismissLabel={t("Explore.coachmarkGotIt")}
        />
        {/* Exam-lens tabs */}
        <div ref={lensTabsRef} className="flex w-full items-center gap-1 overflow-x-auto rounded-lg bg-muted p-1">
          {LENSES.map((l) => (
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
              {t(LENS_LABEL[l])}
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
          {CATEGORIES.map((c) => (
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
        onOpenChange={(open) => !open && patchParams({ item: null })}
      />
    </div>
  );
}
