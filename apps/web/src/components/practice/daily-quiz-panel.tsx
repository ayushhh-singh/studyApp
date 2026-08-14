import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, Loader2, Sparkles } from "lucide-react";
import type { DailyQuizArchiveItem } from "@neev/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { PaginationControls } from "@/components/ui-x/pagination-controls";
import { ALL_PAPERS, PaperSegmentTabs } from "@/components/ui-x/paper-segment-tabs";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { RecentThenArchive } from "@/components/ui-x/recent-then-archive";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { TestCard } from "@/components/practice/test-card";
import { useDailyQuizArchive, useEnsureTodayQuiz } from "@/hooks/use-daily";
import { useLocale } from "@/hooks/use-locale";
import { usePaperCatalog } from "@/hooks/use-paper-catalog";
import { cn } from "@/lib/utils";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDate(offsetDays = 0): string {
  return new Date(Date.now() + IST_OFFSET_MS + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Both daily quizzes are built per day, so a complete day has two "today" rows. */
const DAILY_QUIZ_VARIANT_COUNT = 2;

/**
 * How many days the recent strip covers.
 *
 * ── WHY THIS CAN BE A PREFIX OF PAGE 1 RATHER THAN ITS OWN REQUEST ──────────
 * The archive is ordered `scheduled_date` DESC and served 20 rows per page, so
 * the newest 7 days are at most 7 × DAILY_QUIZ_VARIANT_COUNT = 14 rows and
 * always fit inside page 1 — with margin. A DATE cut is a PREFIX of a
 * date-sorted list (unlike the archive's paper filter, which is sparse and so
 * must be applied server-side), which is what makes deriving it client-side
 * correct rather than merely convenient.
 *
 * That headroom is the load-bearing part: if a third daily variant is ever
 * added, 7 × 3 = 21 exceeds the page and the strip would silently truncate its
 * oldest day. Keep `RECENT_DAYS × DAILY_QUIZ_VARIANT_COUNT` under the API's
 * DAILY_ARCHIVE_PAGE_SIZE, or give the strip its own request.
 */
const RECENT_DAYS = 7;

function isToday(item: DailyQuizArchiveItem): boolean {
  return item.scheduled_date === istDate(0);
}

/**
 * Yesterday's quiz is the one real makeup opportunity, so it keeps its badge
 * wherever it renders.
 */
function isMakeup(item: DailyQuizArchiveItem): boolean {
  return item.scheduled_date === istDate(-1);
}

function DayLabel({ item }: { item: DailyQuizArchiveItem }) {
  const { t } = useTranslation();
  const locale = useLocale();

  if (isToday(item)) {
    return <span className="text-xs font-semibold uppercase tracking-wide text-primary">{t("Practice.dailyToday")}</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground tabular-nums">
        {new Date(`${item.scheduled_date}T00:00:00Z`).toLocaleDateString(locale, {
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        })}
      </span>
      {isMakeup(item) && (
        <span className="rounded-full bg-marigold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-marigold-foreground">
          {t("Practice.dailyMakeupBadge")}
        </span>
      )}
    </span>
  );
}

/**
 * The recent strip: one COLUMN PER PAPER, not one list per day.
 *
 * GS and CSAT are structurally different papers — different scoring, different
 * subject mix, different purpose (GS is the merit paper; CSAT is qualifying) —
 * so a student scanning "how have I been doing on CSAT" should not have to
 * filter GS rows out with their eyes. Segmenting by paper and letting DATE be
 * the row label inverts the old grouping, which put the two papers adjacent on
 * every single day.
 *
 * Columns come from the DATA's own paper codes, ordered and labelled by the
 * exam registry — never a hardcoded ["GS-I", "CSAT"], which would render one
 * commission's paper names to a student preparing for another exam.
 */
function RecentDays({ items }: { items: DailyQuizArchiveItem[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { latinLabel, compare } = usePaperCatalog();

  const cutoff = istDate(-(RECENT_DAYS - 1));
  // Inside the memo, not above it: computed outside, the filtered array is a
  // fresh reference on every render and the memo below never hits.
  const { recent, columns } = useMemo(() => {
    const recent = items.filter((item) => item.scheduled_date >= cutoff);
    const byPaper = new Map<string, DailyQuizArchiveItem[]>();
    for (const item of recent) {
      // A legacy pre-split blended quiz has no paper_code; it gets its own
      // column rather than being dropped or silently folded into a real paper's.
      const key = item.paper_code ?? "";
      const bucket = byPaper.get(key);
      if (bucket) bucket.push(item);
      else byPaper.set(key, [item]);
    }
    return { recent, columns: [...byPaper.entries()].sort(([a], [b]) => compare(a || null, b || null)) };
  }, [items, cutoff, compare]);

  if (recent.length === 0) {
    return (
      <p className="text-sm leading-[1.75] text-muted-foreground">{t("Practice.dailyNoRecent", { days: RECENT_DAYS })}</p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {columns.map(([paperCode, rows]) => (
        <div key={paperCode || "mixed"} className="flex min-w-0 flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {paperCode ? latinLabel(paperCode) : t("Practice.mixed")}
          </h3>
          <ul className="flex flex-col gap-2">
            {rows.map((item) => (
              <li key={item.id} className="flex flex-col gap-1">
                <DayLabel item={item} />
                <TestCard test={item} locale={locale} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * The full archive: every past day, paginated, with the same paper segmentation
 * as the recent strip so the two views read as one surface.
 *
 * The paper filter is applied SERVER-SIDE (see `useDailyQuizArchive`) — a paper
 * is a sparse filter over a date-ordered list, so narrowing a fetched page
 * would give ragged pages and a wrong page count.
 */
function DailyArchive({ paperCodes }: { paperCodes: string[] }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { latinLabel } = usePaperCatalog();
  const [paper, setPaper] = useState<string>(ALL_PAPERS);
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useDailyQuizArchive(page, paper === ALL_PAPERS ? undefined : paper);

  function selectPaper(next: string) {
    setPaper(next);
    // A page number from the previous filter describes a different, usually
    // longer list — keeping it can land the user on an empty page.
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <PaperSegmentTabs codes={paperCodes} value={paper} onValueChange={selectPaper} includeAll />

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
          icon={CalendarDays}
          title={t("Practice.dailyEmptyTitle")}
          description={t("Practice.dailyEmptyDescription")}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {data.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <DayLabel item={item} />
                {/* Only while the list is mixed — repeating the paper name under
                    a tab that already says it is noise. */}
                {paper === ALL_PAPERS && item.paper_code && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    {latinLabel(item.paper_code)}
                  </span>
                )}
              </span>
              <TestCard test={item} locale={locale} />
            </li>
          ))}
        </ul>
      )}

      <PaginationControls
        page={page}
        totalPages={data?.pagination.total_pages ?? 1}
        onPageChange={setPage}
        labels={{
          previous: t("Practice.dailyPrev"),
          next: t("Practice.dailyNext"),
          pageOf: t("Practice.dailyPageOf", { page, total: data?.pagination.total_pages ?? 1 }),
        }}
      />
    </div>
  );
}

/**
 * Self-heal CTA: the 5:00 AM IST generator hasn't produced today's quiz yet
 * (common in dev, possible in prod if a run is missed). Calls the same
 * self-heal endpoint the cron job would have run, then lets the invalidated
 * archive query re-render with the real quiz — no navigation needed here.
 *
 * `bare` drops the icon/title/border chrome for use inside `EmptyState`'s
 * `action` slot, which already renders an icon + title of its own.
 */
function GenerateTodayCta({ bare = false }: { bare?: boolean }) {
  const { t } = useTranslation();
  const ensureToday = useEnsureTodayQuiz();

  const button = (
    <div className="flex flex-col items-center gap-1.5">
      <Button type="button" onClick={() => ensureToday.mutate()} disabled={ensureToday.isPending}>
        {/* Always mounted (see exam-switch-dialog.tsx) so the button's
            `has-[>svg]:px-*` size variant never toggles mid-request —
            conditionally mounting this animated the button's own
            padding/width via `transition-all` at the exact moment `disabled`
            engaged, which a real captured frame showed as doubled/ghosted
            text. Only opacity/animation change now. The trailing spacer
            mirrors the icon so whichever label is showing stays centred
            instead of the icon+label GROUP being centred (which pushes the
            label off-centre at rest — also caught live). */}
        <Loader2
          className={cn("size-4", ensureToday.isPending ? "animate-spin opacity-100" : "opacity-0")}
          aria-hidden
        />
        {ensureToday.isPending ? t("Practice.dailyGenerating") : t("Practice.dailyGenerateButton")}
        <span className="size-4" aria-hidden />
      </Button>
      {ensureToday.isError && <p className="text-xs text-destructive">{t("Practice.dailyGenerateError")}</p>}
      {ensureToday.isSuccess && !ensureToday.data.gs && !ensureToday.data.csat && (
        <p className="text-xs text-muted-foreground">{t("Practice.dailyGenerateEmpty")}</p>
      )}
    </div>
  );

  if (bare) return button;

  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-semibold">{t("Practice.dailyGenerateTitle")}</p>
          <p className="text-xs text-muted-foreground">{t("Practice.dailyGenerateDescription")}</p>
        </div>
      </div>
      {button}
    </div>
  );
}

export function DailyQuizPanel() {
  const { t } = useTranslation();
  // Page 1 unfiltered backs BOTH the recent strip (a date prefix of it) and the
  // paper-code list the archive's segments are built from, so the collapsed
  // surface costs exactly one request.
  const { data, isLoading, isError, refetch } = useDailyQuizArchive(1);
  const { isLoading: catalogLoading } = usePaperCatalog();

  // Gate on the catalog too: PaperSegmentTabs orders and labels its segments
  // from the registry, and rendering through the loading window shows a
  // provisional alphabetical order that visibly reshuffles (usePaperCatalog's
  // own documented regression).
  if (isLoading || catalogLoading) {
    return (
      <div className="flex flex-col gap-3">
        <ListRowSkeleton />
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

  // A failed fetch must never render as "no quizzes yet" — the two are
  // indistinguishable from `data` alone. See ui-x/query-error-state.tsx.
  if (isError) return <QueryErrorState onRetry={() => refetch()} />;

  if (!data || data.items.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={t("Practice.dailyEmptyTitle")}
        description={t("Practice.dailyEmptyDescription")}
        action={<GenerateTodayCta bare />}
      />
    );
  }

  const paperCodes = [...new Set(data.items.map((item) => item.paper_code).filter((c): c is string => !!c))];
  // Both quizzes (GS + CSAT) are built each day; offer the self-heal CTA until
  // both of today's rows are present, not just one.
  const todayComplete = data.items.filter(isToday).length >= DAILY_QUIZ_VARIANT_COUNT;

  return (
    <div className="flex flex-col gap-4">
      {!todayComplete && <GenerateTodayCta />}
      <RecentThenArchive
        param="daily"
        expandLabel={t("Practice.dailySeeArchive")}
        collapseLabel={t("Practice.dailyBackToRecent")}
        recent={<RecentDays items={data.items} />}
        archive={<DailyArchive paperCodes={paperCodes} />}
      />
    </div>
  );
}
