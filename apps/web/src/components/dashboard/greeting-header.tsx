import { useTranslation } from "react-i18next";
import { Snowflake, ShieldCheck } from "lucide-react";
import type { DashboardGreeting } from "@prayasup/shared";
import { PageHeader } from "@/components/ui-x/page-header";
import { StreakFlame } from "@/components/ui-x/streak-flame";
import { ExamCountdownChip } from "./exam-countdown-chip";

/** Banked streak freezes as snowflake pips (max 2), with a live count for a11y. */
function FreezePips({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex h-9 items-center gap-1 rounded-full border border-transparent bg-primary/10 px-2.5 text-primary"
      title={t("Dashboard.freezesBanked", { count })}
      aria-label={t("Dashboard.freezesBanked", { count })}
    >
      {Array.from({ length: count }).map((_, i) => (
        <Snowflake key={i} className="size-4" aria-hidden />
      ))}
    </span>
  );
}

export function GreetingHeader({ greeting }: { greeting: DashboardGreeting }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
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
            <FreezePips count={greeting.streak_freezes} />
            <ExamCountdownChip exam={greeting.next_exam} />
          </div>
        }
      />
      {greeting.freeze_used_recently && (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-primary">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          <span>{t("Dashboard.freezeUsed")}</span>
        </div>
      )}
    </div>
  );
}
