import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight, Loader2, Sparkles } from "lucide-react";
import type { DailyQuizArchiveItem } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { TestCard } from "@/components/practice/test-card";
import { useDailyQuizArchive, useEnsureTodayQuiz } from "@/hooks/use-daily";
import { useLocale } from "@/hooks/use-locale";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDate(offsetDays = 0): string {
  return new Date(Date.now() + IST_OFFSET_MS + offsetDays * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Today / Yesterday (makeup) / date label for an archived quiz. */
function dayLabel(scheduledDate: string, t: (k: string) => string): { text: string; makeup: boolean } | null {
  if (scheduledDate === istDate(0)) return { text: t("Practice.dailyToday"), makeup: false };
  if (scheduledDate === istDate(-1)) return { text: t("Practice.dailyYesterday"), makeup: true };
  return null;
}

function ArchiveRow({ item }: { item: DailyQuizArchiveItem }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const label = dayLabel(item.scheduled_date, t);
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">{label.text}</span>
          {label.makeup && (
            <span className="rounded-full bg-marigold/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-marigold">
              {t("Practice.dailyMakeupBadge")}
            </span>
          )}
        </div>
      )}
      <TestCard test={item} locale={locale} />
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
        {ensureToday.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {ensureToday.isPending ? t("Practice.dailyGenerating") : t("Practice.dailyGenerateButton")}
      </Button>
      {ensureToday.isError && <p className="text-xs text-destructive">{t("Practice.dailyGenerateError")}</p>}
      {ensureToday.isSuccess && ensureToday.data === null && (
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
  const [page, setPage] = useState(1);
  const { data, isLoading } = useDailyQuizArchive(page);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <ListRowSkeleton />
        <ListRowSkeleton />
        <ListRowSkeleton />
      </div>
    );
  }

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

  const totalPages = data.pagination.total_pages;
  const hasToday = data.items.some((item) => item.scheduled_date === istDate(0));

  return (
    <div className="flex flex-col gap-4">
      {page === 1 && !hasToday && <GenerateTodayCta />}
      <ul className="flex flex-col gap-3">
        {data.items.map((item) => (
          <li key={item.id}>
            <ArchiveRow item={item} />
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft aria-hidden />
            {t("Practice.dailyPrev")}
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("Practice.dailyPageOf", { page, total: totalPages })}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            {t("Practice.dailyNext")}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
