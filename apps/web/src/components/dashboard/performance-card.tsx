import { useTranslation } from "react-i18next";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { DashboardPerformance } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { scoreBandColor } from "@/lib/score-band";

function Sparkline({ data }: { data: DashboardPerformance["recent_scores"] }) {
  const chartData = data.map((d, i) => ({ index: i, score: d.score_pct }));
  // Negative marking can push score_pct below 0 — clamping the domain to
  // [0, 100] would silently flatten/clip those points instead of showing
  // the (meaningful) negative score.
  const minScore = Math.min(0, ...chartData.map((d) => d.score));
  return (
    <ResponsiveContainer width="100%" height={96}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <YAxis domain={[minScore, 100]} hide />
        <Tooltip
          formatter={(value) => [`${Math.round(Number(value))}%`, ""]}
          labelFormatter={() => ""}
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
          dot={{ r: 4, fill: "var(--chart-4)", strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PerformanceCard({ data }: { data: DashboardPerformance }) {
  const { t } = useTranslation();

  return (
    <SectionCard title={t("Dashboard.performanceTitle")}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("Dashboard.performanceSparklineLabel")}
          </span>
          {data.recent_scores.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Dashboard.performanceNoScores")}</p>
          ) : (
            <Sparkline data={data.recent_scores} />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {t("Dashboard.performanceAccuracyByPaper")}
          </span>
          {data.accuracy_by_paper.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("Dashboard.performanceNoPapers")}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.accuracy_by_paper.map((paper) => (
                <div key={paper.paper_code} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 truncate text-xs font-medium">{paper.paper_code}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${paper.accuracy_pct}%`, backgroundColor: scoreBandColor(paper.accuracy_pct) }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums">
                    {Math.round(paper.accuracy_pct)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
