import { useTranslation } from "react-i18next";
import type { DashboardGreeting } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { StreakFlame } from "@/components/ui-x/streak-flame";
import { ExamCountdownChip } from "./exam-countdown-chip";

export function GreetingHeader({ greeting }: { greeting: DashboardGreeting }) {
  const { t } = useTranslation();

  return (
    <PageHeader
      title={
        greeting.display_name
          ? t("Dashboard.greeting", { name: greeting.display_name })
          : t("Dashboard.greetingFallback")
      }
      description={t("Dashboard.description")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <StreakFlame count={greeting.streak_count} animate={greeting.streak_incremented_today} />
          <ExamCountdownChip exam={greeting.next_exam} />
        </div>
      }
    />
  );
}
