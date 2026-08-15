import { useMemo } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { ProgressRing } from "@/components/ui-x/progress-ring";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { EmptyState } from "@/components/ui-x/empty-state";
import { SeriesCalendar, SeriesMaxNotice, SeriesStartButton } from "@/components/practice/series-calendar";
import { useSeriesEntitlement, useTestSeriesDetail } from "@/hooks/use-test-series";
import { useLocale } from "@/hooks/use-locale";

export const handle = { titleKey: "TestSeries.title" };

/**
 * A published series calendar — a STUDY PLAN, not a list of dates. Every real
 * institute schedule ships a "Topics covered" and a "Sources covered" column per
 * test (docs/test-series-design.md §2.4), so both are the body of each row.
 *
 * RESPONSIVE INTENT. The list stays SINGLE-COLUMN at every width on purpose: the
 * entries are chronological, and a multi-column grid on a wide screen breaks
 * reading order into a Z rather than a timeline. What changes with width is the
 * summary — the ring and its stats sit beside each other from `sm` up and stack
 * below it, which is the only place a row genuinely does not fit at 390px.
 */
export function Component() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const locale = useLocale();
  const query = useTestSeriesDetail(slug);
  const series = query.data;
  // The calendar itself is free to read; only sitting a paper is Max.
  const entitled = useSeriesEntitlement();

  const progress = useMemo(() => {
    if (!series) return { done: 0, total: 0, open: 0 };
    const done = series.entries.filter((e) => e.state === "submitted" || e.state === "submitted_late").length;
    const open = series.entries.filter((e) => e.state === "open" || e.state === "in_progress").length;
    return { done, total: series.entries.length, open };
  }, [series]);

  // ⚑ BEFORE the early returns. Placing this after them is a Rules-of-Hooks
  // violation: the pending/error branches return early, so on those renders the
  // hook is never called and React sees a different hook count on the next one
  // ("change in the order of Hooks"), which blanks the page. tsc and a
  // production build both pass it — only running the page catches it.
  const next = useMemo(
    () => series?.entries.find((e) => e.state === "open" || e.state === "in_progress") ?? null,
    [series],
  );

  // A failed fetch and an empty result are different things and must not render
  // the same — this app has shipped that confusion three times (see
  // QueryErrorState's own docstring).
  if (query.isError) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("TestSeries.title")} />
        <QueryErrorState onRetry={() => void query.refetch()} />
      </div>
    );
  }

  if (query.isPending || !series) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("TestSeries.title")} />
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-muted h-28 w-full animate-pulse rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={series.title_i18n[locale]}
        description={series.description_i18n ? series.description_i18n[locale] : undefined}
      />

      <SectionCard title={t("TestSeries.progressTitle")}>
        <div className="space-y-4">
          {/* Stacks at 390px, side-by-side from sm — the ring plus three stats is
              the only row here that genuinely cannot fit a narrow screen. */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <ProgressRing
              value={progress.done}
              max={Math.max(1, progress.total)}
              size={76}
              label={t("TestSeries.completedOf", { done: progress.done, total: progress.total })}
            >
              <span className="font-display text-lg">{progress.done}</span>
            </ProgressRing>
            <dl className="grid flex-1 grid-cols-3 gap-3">
              {[
                ["TestSeries.statDone", progress.done],
                ["TestSeries.statOpen", progress.open],
                ["TestSeries.statTotal", progress.total],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-muted-foreground text-xs">{t(k as string)}</dt>
                  <dd className="font-display text-xl">{v as number}</dd>
                </div>
              ))}
            </dl>
            {series.status === "draft" && (
              <span className="bg-marigold/15 text-marigold-foreground self-start rounded-full px-2.5 py-0.5 text-xs font-semibold">
                {t("TestSeries.draft")}
              </span>
            )}
          </div>

          {next ? (
            <div className="bg-primary/10 flex flex-col gap-3 rounded-xl p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="min-w-0 text-sm">
                <span className="text-muted-foreground">{t("TestSeries.nextUp")}: </span>
                <span className="font-medium">
                  {next.title_i18n ? next.title_i18n[locale] : t("TestSeries.paperNumber", { n: next.sequence_no })}
                </span>
              </p>
              {next.test_id ? (
                <SeriesStartButton
                  testId={next.test_id}
                  locale={locale}
                  resume={next.state === "in_progress"}
                  entitled={entitled}
                  className="shrink-0"
                />
              ) : null}
            </div>
          ) : null}

          <p className="text-muted-foreground text-sm">{t("TestSeries.windowRule")}</p>
          {/* Same rule as the index: an empty calendar has nothing to browse, so
              the "free to browse" line would contradict its own empty state. */}
          {series.entries.length > 0 && <SeriesMaxNotice entitled={entitled} />}
        </div>
      </SectionCard>

      {series.entries.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("TestSeries.emptyTitle")}
          description={t("TestSeries.emptyDescription")}
        />
      ) : (
        <SeriesCalendar entries={series.entries} locale={locale} entitled={entitled} />
      )}
    </div>
  );
}
