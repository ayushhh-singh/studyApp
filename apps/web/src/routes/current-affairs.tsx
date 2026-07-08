import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Newspaper, BookMarked } from "lucide-react";
import type { CurrentAffairsCategory, CurrentAffairsItem } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { CurrentAffairsItemCard } from "@/components/current-affairs/item-card";
import { CurrentAffairsDetailSheet } from "@/components/current-affairs/item-detail-sheet";
import { CurrentAffairsQuizButton } from "@/components/current-affairs/quiz-button";
import { useCurrentAffairs } from "@/hooks/use-current-affairs";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "Nav.currentAffairs" };

const CATEGORIES: CurrentAffairsCategory[] = [
  "polity_governance",
  "economy",
  "environment_ecology",
  "science_tech",
  "schemes_welfare",
  "up_state_affairs",
  "national",
  "international",
  "awards_sports_misc",
];

const SELECT_CLASS =
  "h-9 rounded-md border border-input bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";

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
  const [category, setCategory] = useState<CurrentAffairsCategory | "">("");
  const [upOnly, setUpOnly] = useState(false);
  const [page, setPage] = useState(1);
  // Lives in the URL (?item=<id>) rather than pure local state — a mentor
  // citation ("[3]") can now link straight to `/current-affairs?item=<id>`
  // and open that exact item's detail sheet directly (fetched independently
  // by id via useCurrentAffairsItem, so it works regardless of the current
  // category/up-only filters or which page it'd otherwise be on), and the
  // open sheet now survives a refresh/is shareable like any other deep link.
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("item");
  function setSelectedId(id: string | null) {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (id) params.set("item", id);
        else params.delete("item");
        return params;
      },
      { replace: true },
    );
  }

  const { data, isLoading } = useCurrentAffairs({
    category: category || undefined,
    up_only: upOnly || undefined,
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
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/${locale}/magazine`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BookMarked className="size-4" /> {t("Magazine.navTitle")}
            </Link>
            <CurrentAffairsQuizButton />
          </div>
        }
      />

      <SectionCard title={t("CurrentAffairs.latest")}>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={SELECT_CLASS}
            value={category}
            aria-label={t("CurrentAffairs.filterCategoryLabel")}
            onChange={(e) => {
              setCategory(e.target.value as CurrentAffairsCategory | "");
              setPage(1);
            }}
          >
            <option value="">{t("CurrentAffairs.filterAllCategories")}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`CurrentAffairs.category.${c}`)}
              </option>
            ))}
          </select>

          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={upOnly}
            onClick={() => {
              setUpOnly((v) => !v);
              setPage(1);
            }}
            className={cn(
              "border-tulsi/40",
              upOnly ? "bg-tulsi text-white hover:bg-tulsi/90" : "text-tulsi-foreground hover:bg-tulsi/10",
            )}
          >
            {t("CurrentAffairs.upOnlyToggle")}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={Newspaper}
            title={t("CurrentAffairs.emptyTitle")}
            description={t("CurrentAffairs.emptyDescription")}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {groupByDateDescending(data.items).map(([date, items]) => (
              <div key={date} className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {dateLabel(date)}
                </h3>
                <ul className="flex flex-col gap-2">
                  {items.map((item) => (
                    <CurrentAffairsItemCard key={item.id} item={item} locale={locale} onSelect={setSelectedId} />
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
                  onClick={() => setPage((p) => p - 1)}
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
                  onClick={() => setPage((p) => p + 1)}
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
        onOpenChange={(open) => !open && setSelectedId(null)}
      />
    </div>
  );
}
