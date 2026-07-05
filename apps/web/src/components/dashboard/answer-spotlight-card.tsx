import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ArrowRight, NotebookPen } from "lucide-react";
import type { DashboardAnswerSpotlight } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { useLocale } from "@/hooks/use-locale";

export function AnswerSpotlightCard({ data }: { data: DashboardAnswerSpotlight }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const latest = data.latest;
  const pct =
    latest && latest.overall_score !== null && latest.max_score
      ? (latest.overall_score / latest.max_score) * 100
      : null;

  return (
    <SectionCard
      title={t("Dashboard.spotlightTitle")}
      className="border-marigold/30"
      action={
        <span className="inline-flex items-center gap-1.5 rounded-full bg-marigold/15 px-3 py-1 text-xs font-semibold text-marigold-foreground">
          <NotebookPen className="size-3.5" aria-hidden />
          {t("Answers.flagshipBadge")}
        </span>
      }
    >
      {latest ? (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col items-center gap-1 sm:items-start">
            <span className="text-xs font-medium text-muted-foreground">{t("Dashboard.spotlightLatestLabel")}</span>
            {latest.question_stem_i18n && (
              <p className="max-w-md text-center text-sm sm:text-start">{latest.question_stem_i18n[locale]}</p>
            )}
          </div>
          <ScoreGauge value={pct} size={140} />
          <Link
            to={`/${locale}/answers`}
            className="inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("Dashboard.spotlightCta")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-marigold/15 text-marigold">
            <NotebookPen className="size-6" aria-hidden />
          </span>
          <p className="text-sm font-semibold">{t("Dashboard.spotlightEmptyTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("Dashboard.spotlightEmptyDescription")}</p>
          <Link
            to={`/${locale}/answers`}
            className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("Dashboard.spotlightStartCta")}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      )}
    </SectionCard>
  );
}
