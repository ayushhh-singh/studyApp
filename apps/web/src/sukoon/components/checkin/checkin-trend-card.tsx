/**
 * F8 — the WHO-5 (and Exam Stress Self-Check) score history, on /sukoon/you.
 * A 0–100 line over each check-in point, with an honest empty/one-point state
 * (a single dot is shown but never called a "trend"). Careful copy: this is
 * self-reflection over time, never a clinical chart.
 */
import { useState } from "react";
import { LineChartIcon } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { SukoonCheckinType } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useCheckinTrend } from "@/sukoon/lib/use-sukoon-checkins";

const TABS: SukoonCheckinType[] = ["who5", "stress_self_check"];

export function CheckinTrendCard() {
  const { t, language } = useSukoonLanguage();
  const [tab, setTab] = useState<SukoonCheckinType>("who5");
  const trendQuery = useCheckinTrend(tab);
  const points = trendQuery.data?.points ?? [];
  const latest = points.length ? points[points.length - 1] : null;

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
    });

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <LineChartIcon className="size-4 text-secondary" aria-hidden />
          {t("Sukoon.checkin.trendTitle")}
        </span>
      }
      description={t("Sukoon.checkin.trendSub")}
      action={
        <div className="flex gap-1 rounded-full bg-muted p-1">
          {TABS.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setTab(tp)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                tab === tp
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`Sukoon.checkin.trendTab.${tp}`)}
            </button>
          ))}
        </div>
      }
    >
      {trendQuery.isPending ? (
        <div className="h-24 animate-pulse rounded-xl bg-muted" />
      ) : points.length === 0 ? (
        <EmptyState
          icon={LineChartIcon}
          title={t("Sukoon.checkin.trendEmptyTitle")}
          description={t("Sukoon.checkin.trendEmptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <ResponsiveContainer width="100%" height={140}>
            <LineChart
              data={points.map((p, i) => ({ index: i, score: p.score, date: p.date }))}
              margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            >
              <YAxis domain={[0, 100]} hide />
              <Tooltip
                formatter={(value) => [String(value), ""]}
                labelFormatter={(_, payload) =>
                  dateLabel((payload?.[0]?.payload as { date: string } | undefined)?.date ?? "")
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
                dataKey="score"
                stroke="var(--secondary)"
                strokeWidth={2}
                dot={{ r: 3, fill: "var(--secondary)", strokeWidth: 0 }}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
          {latest ? (
            <p className="text-xs text-muted-foreground">
              {t("Sukoon.checkin.trendLatest", { score: latest.score, date: dateLabel(latest.date) })}
              {points.length === 1 ? ` · ${t("Sukoon.checkin.trendOnePoint")}` : ""}
            </p>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
