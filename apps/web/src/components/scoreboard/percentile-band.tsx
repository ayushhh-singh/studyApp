import { useTranslation } from "react-i18next";
import { TrendingUp } from "lucide-react";
import type { EvaluationPercentile } from "@prayasup/shared";

/** Private percentile band — withheld until the qualifying pool clears 30 (see Scoreboard.percentileLocked). */
export function PercentileBand({ data }: { data: EvaluationPercentile | null | undefined }) {
  const { t } = useTranslation();
  if (!data || (!data.eligible && data.participants === 0)) return null;

  return (
    <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-center text-sm text-muted-foreground">
      <TrendingUp className="size-4 shrink-0 text-primary" aria-hidden />
      {data.eligible && data.percentile != null
        ? t("Scoreboard.percentileBand", { percentile: Math.round(data.percentile) })
        : t("Scoreboard.percentileLocked", { participants: data.participants })}
    </div>
  );
}
