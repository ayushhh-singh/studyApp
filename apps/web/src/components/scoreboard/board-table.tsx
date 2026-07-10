import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import type { ScoreboardRow } from "@prayasup/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BoardTable({
  rows,
  participants,
  showAccuracy = true,
  showTime = false,
  showMocksAttempted = false,
  scoreSuffix = "",
  emptyTitle,
  emptyDescription,
}: {
  rows: (ScoreboardRow & { mocks_attempted?: number })[];
  participants: number;
  showAccuracy?: boolean;
  showTime?: boolean;
  showMocksAttempted?: boolean;
  scoreSuffix?: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const { t } = useTranslation();

  if (participants === 0) {
    return <EmptyState icon={Users} title={emptyTitle} description={emptyDescription} />;
  }

  // rows may include the viewer's own row after a gap (outside the top-N cap)
  // — insert a visual break rather than pretending it's contiguous.
  let lastRank = 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t("Scoreboard.participants", { count: participants })}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold text-muted-foreground">
              <th className="w-12 py-2 pr-2">{t("Scoreboard.columnRank")}</th>
              <th className="py-2 pr-2">{t("Scoreboard.columnHandle")}</th>
              <th className="py-2 pr-2 text-right">{t("Scoreboard.columnScore")}</th>
              {showAccuracy && <th className="py-2 pr-2 text-right">{t("Scoreboard.columnAccuracy")}</th>}
              {showTime && <th className="py-2 pr-2 text-right">{t("Scoreboard.columnTime")}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const showGapDivider = lastRank > 0 && row.rank > lastRank + 1;
              lastRank = row.rank;
              return (
                <tr
                  key={`${row.rank}-${row.handle ?? "anon"}-${row.is_you ? "you" : row.score}`}
                  className={cn(
                    showGapDivider && "border-t border-dashed border-border",
                    row.is_you ? "bg-primary/10" : undefined,
                  )}
                >
                  <td className="py-2 pr-2 font-semibold tabular-nums">{row.rank}</td>
                  <td className="py-2 pr-2">
                    <span className={cn(row.is_you && "font-semibold")}>
                      {row.handle ?? t("Scoreboard.anonymous")}
                    </span>
                    {row.is_you && <span className="ml-1 text-xs text-muted-foreground">{t("Scoreboard.you")}</span>}
                    {showMocksAttempted && row.mocks_attempted != null && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {t("Scoreboard.mocksAttempted", { count: row.mocks_attempted })}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {Math.round(row.score * 100) / 100}
                    {scoreSuffix}
                  </td>
                  {showAccuracy && (
                    <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                      {row.accuracy_pct != null ? `${row.accuracy_pct}%` : "—"}
                    </td>
                  )}
                  {showTime && (
                    <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                      {row.time_taken_seconds != null ? formatDuration(row.time_taken_seconds) : "—"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
