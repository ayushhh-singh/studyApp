import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
} from "recharts";
import { PenSquare, TrendingDown, TrendingUp } from "lucide-react";
import { RUBRIC_DIMENSION_KEYS, type DimensionInsight, type EvaluationTrendPoint } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { DIMENSION_LABEL_KEYS } from "@/lib/rubric-labels";
import { cn } from "@/lib/utils";

const INSIGHT_THRESHOLD = 5;
const RADAR_SAMPLE = 5;

function TrendChart({ points }: { points: EvaluationTrendPoint[] }) {
  const data = points.map((p, i) => ({ index: i, score: p.overall_pct, date: p.date }));
  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <YAxis domain={[0, 100]} hide />
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

function DimensionRadar({ points }: { points: EvaluationTrendPoint[] }) {
  const { t } = useTranslation();
  const sample = points.slice(-RADAR_SAMPLE);
  const radarData = RUBRIC_DIMENSION_KEYS.map((key) => {
    const values = sample.map((p) => p.dimension_pct[key]).filter((v): v is number => typeof v === "number");
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    return { dimension: t(DIMENSION_LABEL_KEYS[key]), value: Math.round(avg) };
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={radarData} outerRadius="75%">
        <PolarGrid stroke="var(--border)" />
        <PolarAngleAxis dataKey="dimension" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar
          dataKey="value"
          stroke="var(--chart-4)"
          fill="var(--chart-4)"
          fillOpacity={0.25}
          isAnimationActive={false}
        />
        <Tooltip
          formatter={(value) => [`${value}%`, ""]}
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--popover-foreground)",
          }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}

function InsightLine({ insight }: { insight: DimensionInsight }) {
  const { t } = useTranslation();
  const labelKey = DIMENSION_LABEL_KEYS[insight.dimension_key];
  const meaningful = insight.delta_pct !== null && Math.abs(insight.delta_pct) >= INSIGHT_THRESHOLD;

  if (!meaningful) {
    return (
      <li className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
        {t("Profile.insightSteady", { dimension: t(labelKey) })}
      </li>
    );
  }

  const positive = (insight.delta_pct ?? 0) > 0;
  return (
    <li className={cn("flex items-center gap-2 text-sm font-medium", positive ? "text-tulsi-foreground" : "text-coral-foreground")}>
      {positive ? <TrendingUp className="size-4 shrink-0" aria-hidden /> : <TrendingDown className="size-4 shrink-0" aria-hidden />}
      {t(positive ? "Profile.insightUp" : "Profile.insightDown", {
        dimension: t(labelKey),
        delta: Math.abs(Math.round(insight.delta_pct ?? 0)),
      })}
    </li>
  );
}

export function WritingProgressCard({
  trend,
  insights,
  isLoading,
}: {
  trend: EvaluationTrendPoint[] | undefined;
  insights: DimensionInsight[] | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const hasData = useMemo(() => (trend ?? []).length > 0, [trend]);

  return (
    <SectionCard title={t("Profile.writingProgressTitle")} description={t("Profile.writingProgressDescription")}>
      {isLoading || !trend ? (
        <Skeleton className="h-52 w-full" />
      ) : !hasData ? (
        <EmptyState
          icon={PenSquare}
          title={t("Profile.writingProgressEmptyTitle")}
          description={t("Profile.writingProgressEmptyDescription")}
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("Profile.writingProgressTrendLabel")}
            </span>
            <TrendChart points={trend} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("Profile.writingProgressRadarLabel")}
            </span>
            <DimensionRadar points={trend} />
          </div>
          {insights && insights.length > 0 && (
            <ul className="col-span-full flex flex-col gap-2 border-t border-border pt-4">
              {insights.map((insight) => (
                <InsightLine key={insight.dimension_key} insight={insight} />
              ))}
            </ul>
          )}
        </div>
      )}
    </SectionCard>
  );
}
