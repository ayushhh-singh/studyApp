import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { History } from "lucide-react";
import type { AttemptListItem } from "@neev/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { PaginationControls } from "@/components/ui-x/pagination-controls";
import { ALL_PAPERS, PaperSegmentTabs } from "@/components/ui-x/paper-segment-tabs";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { RecentThenArchive } from "@/components/ui-x/recent-then-archive";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useAttempts } from "@/hooks/use-attempt";
import { useLocale } from "@/hooks/use-locale";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";
import { scoreBandTextColor } from "@/lib/score-band";
import { formatScoreValue } from "@/lib/format-score";

/**
 * How many attempts the main view shows before the archive takes over.
 *
 * Safe to cut from page 1 for the same reason the daily strip is: this is a
 * COUNT prefix of a `submitted_at` DESC list, and the API serves 10 rows per
 * page. Keep this under ATTEMPTS_PAGE_SIZE or give the recent view its own
 * request.
 */
const RECENT_ATTEMPTS = 5;

function AttemptRow({ item, showPaper }: { item: AttemptListItem; showPaper: boolean }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { latinLabel } = usePaperCatalog();
  const pct = item.score !== null && item.total ? (item.score / item.total) * 100 : null;

  return (
    <Link
      to={`/${locale}/practice/attempt/${item.id}/result`}
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <p className="line-clamp-2 text-sm" lang={locale}>
        {item.test_title_i18n?.[locale] ?? t("Practice.historyUntitled")}
      </p>
      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{new Date(item.submitted_at).toLocaleDateString(locale)}</span>
        {/* The registry's own label, not the raw paper_code this row used to
            print — "GS-I" rather than "PRE_GS1". Suppressed when a paper tab is
            already selected, since repeating it under its own tab is noise. */}
        {showPaper && item.paper_code && <span>{latinLabel(item.paper_code)}</span>}
        {pct !== null && (
          <span className="font-semibold tabular-nums" style={{ color: scoreBandTextColor(pct) }}>
            {formatScoreValue(item.score ?? 0)}/{formatScoreValue(item.total ?? 0)}
          </span>
        )}
      </div>
    </Link>
  );
}

function AttemptList({ items, showPaper }: { items: AttemptListItem[]; showPaper: boolean }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id}>
          <AttemptRow item={item} showPaper={showPaper} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The full history: every submitted attempt, paginated, segmented by paper.
 *
 * Segmentation matters more here than anywhere else in the app: this one list
 * mixes GS, CSAT, sectional and mock attempts, whose scores are on completely
 * different scales. Reading them interleaved invites comparing a 40-mark
 * sectional against a 200-mark mock as if they were the same measurement.
 */
function HistoryArchive({ paperCodes }: { paperCodes: string[] }) {
  const { t } = useTranslation();
  const [paper, setPaper] = useState<string>(ALL_PAPERS);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useAttempts(page, paper === ALL_PAPERS ? undefined : paper);

  function selectPaper(next: string) {
    setPaper(next);
    // A page number from the previous filter describes a longer list and can
    // land the user on an empty page.
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <PaperSegmentTabs codes={paperCodes} value={paper} onValueChange={selectPaper} includeAll />

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <ListRowSkeleton />
          <ListRowSkeleton />
        </div>
      ) : isError ? (
        <QueryErrorState onRetry={() => refetch()} />
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          icon={History}
          title={t("Practice.historyEmptyTitle")}
          description={t("Practice.historyEmptyDescription")}
        />
      ) : (
        <AttemptList items={data.items} showPaper={paper === ALL_PAPERS} />
      )}

      <PaginationControls
        page={page}
        totalPages={data?.pagination.total_pages ?? 1}
        onPageChange={setPage}
        labels={{
          previous: t("Practice.historyPrev"),
          next: t("Practice.historyNext"),
          pageOf: t("Practice.historyPageOf", { page, total: data?.pagination.total_pages ?? 1 }),
        }}
      />
    </div>
  );
}

export function AttemptHistoryList() {
  const { t } = useTranslation();
  // Page 1 unfiltered backs BOTH the recent list (a count prefix of it) and the
  // paper-code list the archive's segments are built from, so the collapsed
  // surface costs exactly one request.
  const { data, isLoading, isError, refetch } = useAttempts(1);
  const { isLoading: catalogLoading } = usePaperCatalog();

  // Gate on the catalog too: paper labels and segment order both come from the
  // registry, and rendering through its loading window prints raw codes in a
  // provisional order that visibly reshuffles (usePaperCatalog's own
  // documented regression).
  if (isLoading || catalogLoading) {
    return (
      <div className="flex flex-col gap-2">
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  if (isError) return <QueryErrorState onRetry={() => refetch()} />;

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={History}
        title={t("Practice.historyEmptyTitle")}
        description={t("Practice.historyEmptyDescription")}
      />
    );
  }

  const paperCodes = [...new Set(data.items.map((item) => item.paper_code).filter((c): c is string => !!c))];
  const recent = data.items.slice(0, RECENT_ATTEMPTS);
  // Nothing to expand INTO if page 1 is the whole history and it already fits
  // in the recent list — a "See all" leading to the same five rows is a lie.
  const hasMore = data.pagination.total > recent.length;

  if (!hasMore) return <AttemptList items={recent} showPaper />;

  return (
    <RecentThenArchive
      param="history"
      expandLabel={t("Practice.historySeeAll", { count: data.pagination.total })}
      collapseLabel={t("Practice.historyBackToRecent", { count: RECENT_ATTEMPTS })}
      recent={<AttemptList items={recent} showPaper />}
      archive={<HistoryArchive paperCodes={paperCodes} />}
    />
  );
}
