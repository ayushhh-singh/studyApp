import { useTranslation } from "react-i18next";
import { CheckCircle2, Clock, Flame, Newspaper } from "lucide-react";
import { PageHeader } from "@/components/ui-x/page-header";
import { StatCard } from "@/components/ui-x/stat-card";
import { StatCardSkeleton } from "@/components/ui-x/skeleton";
import { ScoreGauge } from "@/components/ui-x/score-gauge";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useDashboardSummary } from "@/hooks/use-dashboard-summary";

export const handle = { titleKey: "Nav.dashboard" };

export function Component() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardSummary();

  const maxAttempts = data ? Math.max(1, ...data.weekly_activity.map((day) => day.attempts)) : 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Dashboard.title")} description={t("Dashboard.description")} />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {isLoading || !data ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard label={t("Dashboard.attempts")} value={data.attempts_count} icon={CheckCircle2} />
            <StatCard
              label={t("Dashboard.streak")}
              value={data.streak_count}
              hint={t("Dashboard.streakHint")}
              icon={Flame}
            />
            <StatCard label={t("Dashboard.srsDue")} value={data.srs_due_count} icon={Clock} />
            <StatCard
              label={t("Dashboard.currentAffairs")}
              value={data.latest_current_affairs_date ?? t("Dashboard.noData")}
              icon={Newspaper}
            />
          </>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_1fr]">
        <SectionCard title={t("Dashboard.avgScore")} className="items-center">
          {isLoading || !data ? (
            <StatCardSkeleton />
          ) : (
            <ScoreGauge value={data.avg_score_pct} label={t("Dashboard.avgScoreHint")} />
          )}
        </SectionCard>

        <SectionCard title={t("Dashboard.weeklyActivity")}>
          {isLoading || !data ? (
            <StatCardSkeleton />
          ) : data.weekly_activity.length === 0 ? (
            <EmptyState title={t("Dashboard.noActivityTitle")} description={t("Dashboard.noActivityDescription")} />
          ) : (
            <div className="flex items-end gap-2">
              {data.weekly_activity.map((day) => (
                <div key={day.date} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-28 w-full items-end">
                    <div
                      className="w-full rounded-t-md bg-primary/80"
                      style={{ height: `${Math.max(4, (day.attempts / maxAttempts) * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(day.date).toLocaleDateString(undefined, { weekday: "narrow" })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
