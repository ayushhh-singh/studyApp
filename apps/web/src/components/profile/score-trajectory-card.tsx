import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { PaperScoreTrajectory } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { useLocale } from "@/hooks/use-locale";
import { TrendingUp } from "lucide-react";

const SMALL_MULTIPLE_MAX = 3;

function TrajectoryChart({ points }: { points: PaperScoreTrajectory["points"] }) {
  const data = points.map((p, i) => ({ index: i, score: p.overall_pct, date: p.date }));
  const minScore = Math.min(0, ...data.map((d) => d.score));
  return (
    <ResponsiveContainer width="100%" height={96}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <YAxis domain={[minScore, 100]} hide />
        <Tooltip
          formatter={(value) => [`${Math.round(Number(value))}%`, ""]}
          labelFormatter={(_, payload) => (payload?.[0]?.payload as { date: string } | undefined)?.date ?? ""}
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
          dataKey="score"
          stroke="var(--chart-4)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-4)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ScoreTrajectoryCard({
  data,
  isLoading,
}: {
  data: PaperScoreTrajectory[] | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const [selectedPaper, setSelectedPaper] = useState<string | undefined>(undefined);

  const withData = useMemo(() => (data ?? []).filter((p) => p.points.length > 0), [data]);
  const selected = withData.find((p) => p.paper_code === selectedPaper) ?? withData[0];

  return (
    <SectionCard title={t("Profile.trajectoryTitle")} description={t("Profile.trajectoryDescription")}>
      {isLoading || !data ? (
        <Skeleton className="h-24 w-full" />
      ) : withData.length === 0 ? (
        <EmptyState
          icon={TrendingUp}
          title={t("Profile.trajectoryEmptyTitle")}
          description={t("Profile.trajectoryEmptyDescription")}
        />
      ) : withData.length <= SMALL_MULTIPLE_MAX ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {withData.map((paper) => (
            <div key={paper.paper_code} className="flex flex-col gap-1">
              <span className="truncate text-xs font-semibold text-muted-foreground">
                {paper.paper_title_i18n[locale]}
              </span>
              <TrajectoryChart points={paper.points} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <select
            className="min-h-9 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={selected?.paper_code ?? ""}
            onChange={(e) => setSelectedPaper(e.target.value)}
          >
            {withData.map((paper) => (
              <option key={paper.paper_code} value={paper.paper_code}>
                {paper.paper_title_i18n[locale]}
              </option>
            ))}
          </select>
          {selected && <TrajectoryChart points={selected.points} />}
        </div>
      )}
    </SectionCard>
  );
}
