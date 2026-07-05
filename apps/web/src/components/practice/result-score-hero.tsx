import { useTranslation } from "react-i18next";
import { Target, Timer, TrendingUp } from "lucide-react";
import type { AttemptResultDetail } from "@prayasup/shared";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { StatCard } from "@/components/ui-x/stat-card";
import { formatSeconds } from "@/lib/format-duration";

export function ResultScoreHero({ result }: { result: AttemptResultDetail }) {
  const { t } = useTranslation();
  const { attempt } = result;

  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border bg-card p-5 shadow-sm sm:flex-row sm:items-center">
      <div className="flex flex-col items-center gap-2 sm:shrink-0">
        <ScoreGauge value={result.score_pct} label={t("Practice.resultsScoreLabel")} />
        <span className="font-display text-lg tabular-nums text-muted-foreground">
          {attempt.score ?? 0}
          <span className="text-sm">/{attempt.total ?? 0}</span>
        </span>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
        {result.percentile !== null && (
          <StatCard
            icon={TrendingUp}
            label={t("Practice.resultPercentileLabel")}
            value={t("Practice.resultPercentileValue", { pct: Math.round(result.percentile) })}
          />
        )}
        <StatCard
          icon={Target}
          label={t("Practice.resultAccuracyLabel")}
          value={result.accuracy_pct === null ? "—" : `${Math.round(result.accuracy_pct)}%`}
          hint={t("Practice.resultAccuracyHint", {
            correct: result.correct_count,
            attempted: result.attempted_count,
          })}
        />
        <StatCard
          icon={Timer}
          label={t("Practice.resultAvgTimeLabel")}
          value={result.avg_seconds_per_question === null ? "—" : formatSeconds(result.avg_seconds_per_question)}
        />
        <StatCard
          icon={Timer}
          label={t("Practice.resultAvgTimeCorrectLabel")}
          value={result.avg_seconds_correct === null ? "—" : formatSeconds(result.avg_seconds_correct)}
        />
      </div>
    </div>
  );
}
