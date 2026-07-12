import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Brain, CheckCircle2, TrendingUp } from "lucide-react";
import type { SrsStats } from "@prayasup/shared";
import { StatCard } from "@/components/ui-x/stat-card";
import { FirstVisitCoachmark } from "@/components/ui-x/first-visit-coachmark";
import { ForecastChart } from "./forecast-chart";

export function RevisionStatsHeader({ stats }: { stats: SrsStats }) {
  const { t } = useTranslation();
  const dueCardRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col gap-4">
      <FirstVisitCoachmark
        sectionKey="revision"
        targetRef={dueCardRef}
        message={t("Explore.coachmarkRevision")}
        dismissLabel={t("Explore.coachmarkGotIt")}
      />
      <div className="grid grid-cols-3 gap-3">
        <div ref={dueCardRef}>
          <StatCard label={t("Revision.due")} value={stats.due_today} icon={Brain} />
        </div>
        <StatCard label={t("Revision.reviewedToday")} value={stats.reviewed_today} icon={CheckCircle2} />
        <StatCard
          label={t("Revision.retention")}
          value={stats.retention_pct === null ? "—" : `${stats.retention_pct}%`}
          icon={TrendingUp}
          hint={stats.retention_pct === null ? t("Revision.retentionNoData") : undefined}
        />
      </div>
      <ForecastChart forecast={stats.forecast} />
    </div>
  );
}
