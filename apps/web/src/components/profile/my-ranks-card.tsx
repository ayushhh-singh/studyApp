import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { Trophy } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useMyRankHistory } from "@/hooks/use-scoreboard";

const BOARD_TYPE_LABEL_KEYS: Record<string, string> = {
  daily_quiz: "Scoreboard.subDailyQuiz",
  test: "Scoreboard.subMocks",
  mock_series: "Scoreboard.seriesTitle",
  mains_weekly: "Scoreboard.subAnswerWriting",
};

export function MyRanksCard() {
  const { t } = useTranslation();
  const { data, isLoading } = useMyRankHistory();

  const groups = useMemo(() => {
    const byType = new Map<string, { snapshot_date: string; rank: number; participants: number }[]>();
    for (const p of data?.points ?? []) {
      const arr = byType.get(p.board_type) ?? [];
      arr.push(p);
      byType.set(p.board_type, arr);
    }
    return [...byType.entries()];
  }, [data]);

  return (
    <SectionCard title={t("Scoreboard.myRanksTitle")} description={t("Scoreboard.myRanksDescription")}>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : groups.length === 0 ? (
        <EmptyState icon={Trophy} title={t("Scoreboard.myRanksEmpty")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map(([boardType, points]) => {
            const ranks = points.map((p) => p.rank);
            const maxRank = Math.max(...ranks);
            return (
              <div key={boardType} className="flex flex-col gap-1">
                <span className="truncate text-xs font-semibold text-muted-foreground">
                  {t(BOARD_TYPE_LABEL_KEYS[boardType] ?? boardType)}
                </span>
                <ResponsiveContainer width="100%" height={80}>
                  <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                    <YAxis domain={[1, maxRank]} reversed hide />
                    <Tooltip
                      formatter={(value, _name, item) => [
                        `#${value} / ${(item.payload as { participants: number }).participants}`,
                        "",
                      ]}
                      labelFormatter={(_, payload) =>
                        (payload?.[0]?.payload as { snapshot_date: string } | undefined)?.snapshot_date ?? ""
                      }
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--popover-foreground)",
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="rank"
                      stroke="var(--chart-4)"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "var(--chart-4)", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
