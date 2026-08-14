import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Info, Trophy } from "lucide-react";
import type { AttemptSeriesContext } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { useLocale } from "@/hooks/use-locale";

/**
 * The two-tier rank on a series paper's result page.
 *
 * ⚑ WHY THE UNRANKED CASE NEEDS ITS OWN COPY RATHER THAN JUST HIDING THE RANK.
 * Migration 0127 makes v_test_leaderboard drop an attempt submitted after
 * `ranked_until`, so the ordinary rank card already renders nothing for a late
 * attempt. Nothing is not an answer to a student: it reads as "nobody else took
 * this", or as a bug. This says which tier the score is in and why — the score
 * itself is identical either way.
 */
export function SeriesResultCard({ series }: { series: AttemptSeriesContext }) {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <SectionCard
      title={t("TestSeries.resultContextTitle")}
      action={
        <Link
          to={`/${locale}/test-series/${series.series_slug}`}
          className="text-primary text-sm font-medium hover:underline"
        >
          {t("TestSeries.viewCalendar")}
        </Link>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">
          <span className="font-medium">{series.series_title_i18n[locale]}</span>
          <span className="text-muted-foreground">
            {" — "}
            {t("TestSeries.testNOfM", { n: series.sequence_no, m: series.entry_count })}
          </span>
        </p>

        {series.ranked ? (
          <div className="bg-tulsi/15 flex items-start gap-2 rounded-xl p-3">
            <Trophy className="text-tulsi-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="text-tulsi-foreground text-sm">
              {series.rank != null
                ? t("TestSeries.rankedWithRank", { rank: series.rank, cohort: series.cohort_size })
                : t("TestSeries.rankedNoRank")}
            </p>
          </div>
        ) : (
          <div className="bg-muted flex items-start gap-2 rounded-xl p-3">
            <Info className="text-muted-foreground mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="text-muted-foreground text-sm">
              {t("TestSeries.unrankedExplainer", { cohort: series.cohort_size })}
            </p>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
