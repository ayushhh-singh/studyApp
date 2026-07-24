/** F7 — one journey's detail: description, day-by-day step counts, and the
 *  Start/Continue/Take-it-again CTA into the daily step player. */
import { Link, useNavigate, useParams } from "react-router";
import { Lock, Milestone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-x/page-header";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useJourneyDetail, useStartJourney } from "@/sukoon/lib/use-sukoon-journeys";
import { SignInPrompt } from "@/sukoon/components/journal/journal-ui";

export function Component() {
  const { t, language } = useSukoonLanguage();
  const { session, loading: authLoading } = useAuth();
  const { locale, journeySlug } = useParams<{ locale?: string; journeySlug: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const navigate = useNavigate();

  const query = useJourneyDetail(journeySlug, { enabled: !!session });
  const startMut = useStartJourney();

  if (authLoading) return null;
  if (!session) return <SignInPrompt locale={locale} />;

  if (query.isLoading) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6">
        <PageHeader title={t("Sukoon.journeysTitleShort")} />
        <EmptyState
          icon={Milestone}
          title={t("Sukoon.journeys.notFoundTitle")}
          description={t("Sukoon.journeys.notFoundBody")}
          action={
            <Link to={`${base}/journeys`} className="text-sm font-medium text-secondary hover:underline">
              {t("Sukoon.journeys.backToJourneys")}
            </Link>
          }
        />
      </div>
    );
  }

  const { journey, days_summary } = query.data;
  const title = language === "hi" ? journey.title_hi : journey.title_en;
  const description = language === "hi" ? journey.description_hi : journey.description_en;
  const progress = journey.progress;
  const completed = !!progress?.completed_at;

  const ctaLabel = !progress
    ? t("Sukoon.journeys.start")
    : completed
      ? t("Sukoon.journeys.takeAgain")
      : t("Sukoon.journeys.continueLabel");

  const onCta = () => {
    startMut.mutate(journey.slug, {
      onSuccess: () => navigate(`${base}/journeys/${journey.slug}/day`),
    });
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6" lang={language}>
      <PageHeader
        title={title}
        action={
          <Link to={`${base}/journeys`} className="text-sm font-medium text-muted-foreground hover:text-foreground">
            {t("Sukoon.journeys.backToJourneys")}
          </Link>
        }
      />

      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>

      {journey.locked ? (
        <EmptyState icon={Lock} title={t("Sukoon.tools.lockedTitle")} description={t("Sukoon.tools.lockedBody")} />
      ) : (
        <>
          {days_summary.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {days_summary.map((d) => {
                const reached = completed || (!!progress && d.day <= progress.current_unlocked_day);
                return (
                  <span
                    key={d.day}
                    className={
                      "flex size-8 items-center justify-center rounded-full text-xs font-medium " +
                      (reached ? "bg-secondary/15 text-secondary" : "bg-muted text-muted-foreground")
                    }
                  >
                    {d.day}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
            {completed
              ? t("Sukoon.journeys.completedNote")
              : progress
                ? t("Sukoon.journeys.inProgressNote")
                : t("Sukoon.journeys.notStartedNote")}
          </div>

          <Button size="lg" onClick={onCta} disabled={startMut.isPending}>
            {ctaLabel}
          </Button>
        </>
      )}
    </div>
  );
}
