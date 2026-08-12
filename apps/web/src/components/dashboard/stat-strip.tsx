import { useTranslation } from "react-i18next";
import { Flame, Layers } from "lucide-react";
import type { DashboardGreeting, DashboardToday } from "@neev/shared";
import { StatCard } from "@/components/ui-x/stat-card";
import { ProgressRing } from "@/components/ui-x/progress-ring";

/**
 * The three-tile strip under the greeting on docs/design/reference-1's
 * dashboard (panel 6): a ring tile, a gold streak tile, and a count tile.
 *
 * Every number here already exists on the dashboard summary — no extra fetch,
 * and nothing invented. The reference's own third tile is "Tests Taken / This
 * Month", which this payload does not carry; revision-due is the honest
 * substitute and is the more actionable of the two anyway.
 *
 * The ring lives here rather than inside GuidedTodayCard, which is where it
 * used to be: the reference puts the progress dial in the strip and leaves
 * "Today's Plan" as a pure checklist, and having both would have shown the
 * same fraction twice on one screen.
 */
export function DashboardStatStrip({
  greeting,
  today,
}: {
  greeting: DashboardGreeting;
  today: DashboardToday;
}) {
  const { t } = useTranslation();
  const done = today.checklist_completed;
  const total = today.checklist_total;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <StatCard
        label={t("Dashboard.statPlanLabel")}
        value={`${done}/${total}`}
        hint={done >= total && total > 0 ? t("Dashboard.statPlanHintDone") : t("Dashboard.statPlanHint")}
        leading={
          <ProgressRing
            value={done}
            max={total}
            size={52}
            stroke={5}
            label={t("Dashboard.statPlanLabel")}
          />
        }
      />
      <StatCard
        label={t("Dashboard.statStreakLabel")}
        value={greeting.streak_count}
        hint={
          greeting.streak_freezes > 0
            ? t("Dashboard.freezesBanked", { count: greeting.streak_freezes })
            : t("Dashboard.statStreakHint")
        }
        icon={Flame}
        tone="accent"
      />
      <StatCard
        label={t("Dashboard.statRevisionLabel")}
        value={today.srs_due_count}
        hint={t("Dashboard.statRevisionHint")}
        icon={Layers}
        tone="primary"
        className="sm:col-span-2 lg:col-span-1"
      />
    </div>
  );
}
