import { useTranslation } from "react-i18next";
import type { MainsWeeklyStats } from "@neev/shared";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUpdateProfile } from "@/hooks/use-profile";

/**
 * Everyone is shown on the Mains board by default (users_profile.
 * show_on_mains_board defaults true) — this card's job is the "leave the
 * board" control, not an invite. Always shows the viewer's own private
 * weekly stats regardless of the flag — never gates that behind being on
 * the public board.
 */
export function MainsOptInCard({ optedIn, yourStats }: { optedIn: boolean; yourStats: MainsWeeklyStats }) {
  const { t } = useTranslation();
  const updateProfile = useUpdateProfile();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold">{t("Scoreboard.yourStatsTitle")}</span>
          <span className="text-sm text-muted-foreground">
            {t("Scoreboard.yourStatsEvaluations", { count: yourStats.evaluations_count })}
            {yourStats.avg_pct != null && ` · ${Math.round(yourStats.avg_pct)}%`}
          </span>
          {!yourStats.qualifies && (
            <span className="text-xs text-muted-foreground">
              {t("Scoreboard.yourStatsNeedMore", { count: Math.max(0, 3 - yourStats.evaluations_count) })}
            </span>
          )}
        </div>
        <Button
          type="button"
          variant={optedIn ? "outline" : "default"}
          size="sm"
          onClick={() => updateProfile.mutate({ show_on_mains_board: !optedIn })}
          disabled={updateProfile.isPending}
          className="gap-2"
        >
          <Users className="size-4" aria-hidden />
          {optedIn ? t("Scoreboard.optOutButton") : t("Scoreboard.optInButton")}
        </Button>
      </div>
      {optedIn ? (
        <p className="text-xs text-tulsi-foreground">{t("Scoreboard.optedInNotice")}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{t("Scoreboard.optInDescription")}</p>
      )}
    </div>
  );
}
