import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import type { ScoreboardRow } from "@neev/shared";
import { EmptyState } from "@/components/ui-x/empty-state";
import { formatScoreValue } from "@/lib/format-score";
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
  showDaysParticipated = false,
  scoreSuffix = "",
  emptyTitle,
  emptyDescription,
}: {
  rows: (ScoreboardRow & { mocks_attempted?: number; days_participated?: number })[];
  participants: number;
  showAccuracy?: boolean;
  showTime?: boolean;
  showMocksAttempted?: boolean;
  showDaysParticipated?: boolean;
  scoreSuffix?: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const { t } = useTranslation();

  if (participants === 0) {
    return <EmptyState icon={Users} title={emptyTitle} description={emptyDescription} />;
  }

  // rows may include the viewer's own row after a gap (outside the top-N cap)
  // — insert a visual break rather than pretending it's contiguous. Computed
  // once up front (not a mutable counter threaded through render) since the
  // mobile card list and the sm+ table below both render the same `rows`
  // independently.
  const showGapDivider = rows.map((row, i) => i > 0 && row.rank > rows[i - 1].rank + 1);

  const hasMobileMeta = (row: (typeof rows)[number]) =>
    showAccuracy ||
    showTime ||
    (showMocksAttempted && row.mocks_attempted != null) ||
    (showDaysParticipated && row.days_participated != null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground">
        {t("Scoreboard.participants", { count: participants })}
      </p>

      {/* Mobile: a stacked row-card list, not the real table below. The table
          needs a min-width to keep every column legible, which on a ~390px
          phone forces horizontal scroll with no visible affordance (iOS
          hides the scrollbar until touched) — it reads as clipped/broken
          rather than scrollable. sm+ (tablet/laptop) renders the real table
          instead, unchanged. */}
      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((row, i) => (
          <li
            key={`${row.rank}-${row.handle ?? "anon"}-${row.is_you ? "you" : row.score}-mobile`}
            className={cn(
              "flex flex-col gap-1.5 rounded-lg border border-border p-3 text-sm",
              showGapDivider[i] && "mt-2",
              row.is_you ? "bg-primary/10" : "bg-card",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
                  <span className="sr-only">{t("Scoreboard.columnRank")}: </span>
                  {row.rank}
                </span>
                <span className={cn("truncate", row.is_you && "font-semibold")}>
                  {row.handle ?? t("Scoreboard.anonymous")}
                </span>
                {row.is_you && (
                  <span className="shrink-0 text-xs text-muted-foreground">{t("Scoreboard.you")}</span>
                )}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                <span className="sr-only">{t("Scoreboard.columnScore")}: </span>
                {formatScoreValue(row.score)}
                {scoreSuffix}
              </span>
            </div>
            {hasMobileMeta(row) && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {showAccuracy && (
                  <span>
                    {t("Scoreboard.columnAccuracy")}: {row.accuracy_pct != null ? `${row.accuracy_pct}%` : "—"}
                  </span>
                )}
                {showTime && (
                  <span>
                    {t("Scoreboard.columnTime")}:{" "}
                    {row.time_taken_seconds != null ? formatDuration(row.time_taken_seconds) : "—"}
                  </span>
                )}
                {showMocksAttempted && row.mocks_attempted != null && (
                  <span>{t("Scoreboard.mocksAttempted", { count: row.mocks_attempted })}</span>
                )}
                {showDaysParticipated && row.days_participated != null && (
                  <span>{t("Scoreboard.daysParticipated", { count: row.days_participated })}</span>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {/* sm+ (tablet/laptop): the original table, unchanged. */}
      <div className="hidden overflow-x-auto sm:block">
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
            {rows.map((row, i) => (
              <tr
                key={`${row.rank}-${row.handle ?? "anon"}-${row.is_you ? "you" : row.score}`}
                className={cn(
                  showGapDivider[i] && "border-t border-dashed border-border",
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
                  {showDaysParticipated && row.days_participated != null && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {t("Scoreboard.daysParticipated", { count: row.days_participated })}
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
