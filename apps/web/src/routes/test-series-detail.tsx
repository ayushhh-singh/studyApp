import { useMemo } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, CalendarClock, CalendarDays, CheckCircle2, Clock, Lock, PlayCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { TestSeriesEntry } from "@neev/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { ProgressBar } from "@/components/ui-x/progress-bar";
import { QueryErrorState } from "@/components/ui-x/query-error-state";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { useTestSeriesDetail } from "@/hooks/use-test-series";
import { useLocale } from "@/hooks/use-locale";
import { cn } from "@/lib/utils";

export const handle = { titleKey: "TestSeries.title" };

/**
 * A published series calendar — which is a STUDY PLAN, not a list of dates.
 * Every real institute schedule ships a "Topics covered" and a "Sources
 * covered" column per test (docs/test-series-design.md §2.4), so both are the
 * body of each row rather than something behind a click.
 */
export function Component() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const locale = useLocale();
  const query = useTestSeriesDetail(slug);
  const series = query.data;

  const progress = useMemo(() => {
    if (!series) return { done: 0, total: 0 };
    const done = series.entries.filter((e) => e.state === "submitted" || e.state === "submitted_late").length;
    return { done, total: series.entries.length };
  }, [series]);

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
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <span className="font-display text-2xl">
              {progress.done}
              <span className="text-muted-foreground text-base"> / {progress.total}</span>
            </span>
            {series.status === "draft" && (
              <span className="bg-marigold/15 text-marigold-foreground rounded-full px-2.5 py-0.5 text-xs font-semibold">
                {t("TestSeries.draft")}
              </span>
            )}
          </div>
          <ProgressBar value={progress.total ? (progress.done / progress.total) * 100 : 0} showValue={false} />
          <p className="text-muted-foreground text-sm">{t("TestSeries.windowRule")}</p>
        </div>
      </SectionCard>

      {series.entries.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title={t("TestSeries.emptyTitle")}
          description={t("TestSeries.emptyDescription")}
        />
      ) : (
        <ol className="space-y-3">
          {series.entries.map((entry) => (
            <li key={entry.id}>
              <EntryRow entry={entry} locale={locale} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Per-state pill. Each carries its own icon AND label, never colour alone.
 *
 * The tint/paired-foreground combination is the design system's single
 * most-repeated defect if got wrong: a raw `text-tulsi` on a card measures
 * 2.5:1 and `text-marigold` 1.6:1, so the `-foreground` partner is mandatory.
 */
const STATE_STYLES: Record<TestSeriesEntry["state"], { cls: string; icon: LucideIcon; key: string }> = {
  scheduled: { cls: "bg-muted text-muted-foreground", icon: CalendarClock, key: "TestSeries.stateScheduled" },
  locked: { cls: "bg-muted text-muted-foreground", icon: Lock, key: "TestSeries.stateLocked" },
  open: { cls: "bg-primary/15 text-primary", icon: PlayCircle, key: "TestSeries.stateOpen" },
  in_progress: { cls: "bg-marigold/15 text-marigold-foreground", icon: Clock, key: "TestSeries.stateInProgress" },
  submitted: { cls: "bg-tulsi/15 text-tulsi-foreground", icon: CheckCircle2, key: "TestSeries.stateSubmitted" },
  submitted_late: { cls: "bg-muted text-muted-foreground", icon: CheckCircle2, key: "TestSeries.stateSubmittedLate" },
};

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

function EntryRow({ entry, locale }: { entry: TestSeriesEntry; locale: "en" | "hi" }) {
  const { t } = useTranslation();
  const style = STATE_STYLES[entry.state];
  const Icon = style.icon;
  const opensLabel = new Date(entry.opens_at).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const done = entry.state === "submitted" || entry.state === "submitted_late";

  return (
    <div className="bg-card border-border rounded-xl border p-4">
      {/* Title gets its own row. At 390px a single flex-wrap row squeezes a long
          Hindi title to one visible character instead of wrapping — wrap moves
          whole items, and a flex-1 title shrinks before it wraps. */}
      <div className="flex items-start gap-3">
        <span className="bg-muted text-muted-foreground font-display flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm">
          {entry.sequence_no}
        </span>
        <h3 className="min-w-0 flex-1 text-base font-semibold">
          {entry.title_i18n ? entry.title_i18n[locale] : t("TestSeries.paperNumber", { n: entry.sequence_no })}
        </h3>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Pill className={style.cls}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {t(style.key)}
        </Pill>
        <Pill className="bg-muted text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          {opensLabel}
        </Pill>
        {entry.question_count > 0 ? (
          <Pill className="bg-muted text-muted-foreground">
            {t("TestSeries.questionCount", { count: entry.question_count })}
          </Pill>
        ) : null}
        {entry.duration_minutes ? (
          <Pill className="bg-muted text-muted-foreground">
            {t("TestSeries.minutes", { count: entry.duration_minutes })}
          </Pill>
        ) : null}
        {done && entry.score != null && entry.total != null ? (
          <Pill className="bg-tulsi/15 text-tulsi-foreground">
            {entry.score} / {entry.total}
          </Pill>
        ) : null}
      </div>

      {entry.syllabus_note_i18n ? (
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{entry.syllabus_note_i18n[locale]}</p>
      ) : null}

      {entry.sources_i18n ? (
        <p className="text-muted-foreground mt-2 flex gap-2 text-sm leading-relaxed">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            <span className="text-foreground font-medium">{t("TestSeries.sourcesLabel")}: </span>
            {entry.sources_i18n[locale]}
          </span>
        </p>
      ) : null}

      <div className="mt-4">
        {entry.state === "scheduled" ? (
          // Honest about WHY there is no button: the calendar is published
          // months ahead, the paper is assembled shortly before it opens so it
          // is drawn from the freshest bank.
          <p className="text-muted-foreground text-sm">{t("TestSeries.scheduledExplainer", { date: opensLabel })}</p>
        ) : entry.state === "locked" ? (
          // A locked row states WHEN rather than offering a dead button. The
          // server returns 423 for the same case, so the two agree.
          <p className="text-muted-foreground text-sm">{t("TestSeries.opensOn", { date: opensLabel })}</p>
        ) : done && entry.attempt_id ? (
          <Button asChild variant="outline" className="min-h-11">
            <Link to={`/${locale}/practice/attempt/${entry.attempt_id}/result`}>{t("TestSeries.viewResult")}</Link>
          </Button>
        ) : entry.test_id ? (
          <Button asChild className="min-h-11">
            <Link to={`/${locale}/practice/test/${entry.test_id}`}>
              {entry.state === "in_progress" ? t("TestSeries.resume") : t("TestSeries.start")}
            </Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
