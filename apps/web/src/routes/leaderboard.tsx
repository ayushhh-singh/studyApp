import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/ui-x/page-header";
import { SectionCard } from "@/components/ui-x/section-card";
import { ListRowSkeleton } from "@/components/ui-x/skeleton";
import { useLeaderboard } from "@/hooks/use-engagement";
import { cn } from "@/lib/utils";

// BUILT BUT HIDDEN: reachable at /:locale/leaderboard but deliberately absent
// from NAV_ITEMS / the command palette until opt-in social features land.
export const handle = { titleKey: "Leaderboard.title" };

export function Component() {
  const { t } = useTranslation();
  const { data, isLoading } = useLeaderboard();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t("Leaderboard.title")} description={t("Leaderboard.description")} />
      <SectionCard title={t("Leaderboard.rankingTitle")}>
        {isLoading || !data ? (
          <div className="flex flex-col gap-2">
            <ListRowSkeleton />
            <ListRowSkeleton />
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.map((e) => (
              <li
                key={e.user_id}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2",
                  e.is_you ? "bg-primary/10" : "hover:bg-accent",
                )}
              >
                <span className="w-6 text-sm font-bold tabular-nums text-muted-foreground">{e.rank}</span>
                <span className="flex-1 truncate text-sm font-medium">
                  {e.display_name ?? t("Leaderboard.anonymous")}
                  {e.is_you && <span className="ml-1 text-xs text-primary">{t("Leaderboard.you")}</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("Leaderboard.streak", { count: e.streak_count })}
                </span>
                <span className="w-16 text-right text-sm tabular-nums">
                  {e.accuracy_pct !== null ? `${Math.round(e.accuracy_pct)}%` : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
