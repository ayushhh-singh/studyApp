import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { GreetingHeader } from "@/components/dashboard/greeting-header";
import { GuidedTodayCard } from "@/components/dashboard/guided-today-card";
import { ContinueCard } from "@/components/dashboard/continue-card";
import { TodayCard } from "@/components/dashboard/today-card";
import { useLocale } from "@/hooks/use-locale";
import { PerformanceCard } from "@/components/dashboard/performance-card";
import { WeaknessCard } from "@/components/dashboard/weakness-card";
import { AnswerSpotlightCard } from "@/components/dashboard/answer-spotlight-card";
import { WeeklyDigestCard } from "@/components/dashboard/weekly-digest-card";
import { ActivityHeatmapCard } from "@/components/dashboard/activity-heatmap-card";
import { useDashboardSummary } from "@/hooks/use-dashboard-summary";

export const handle = { titleKey: "Nav.dashboard" };

function CardSkeleton({ title }: { title: string }) {
  return (
    <SectionCard title={title}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-20 w-full" />
      </div>
    </SectionCard>
  );
}

export function Component() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data, isLoading } = useDashboardSummary();

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <CardSkeleton title={t("Dashboard.continueTitle")} />
          <CardSkeleton title={t("Dashboard.todayTitle")} />
        </div>
        <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
          <CardSkeleton title={t("Dashboard.performanceTitle")} />
          <CardSkeleton title={t("Dashboard.weaknessTitle")} />
        </div>
        <CardSkeleton title={t("Dashboard.spotlightTitle")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <GreetingHeader greeting={data.greeting} />

      <GuidedTodayCard today={data.today} cont={data.continue} locale={locale} />

      <div className="grid gap-4 md:grid-cols-2">
        <ContinueCard data={data.continue} />
        <TodayCard data={data.today} />
      </div>

      <WeeklyDigestCard />

      <ActivityHeatmapCard />

      <div className="grid gap-4 md:grid-cols-[2fr_1fr]">
        <PerformanceCard data={data.performance} />
        <WeaknessCard nodes={data.weakness_radar} />
      </div>

      <AnswerSpotlightCard data={data.answer_spotlight} />
    </div>
  );
}
