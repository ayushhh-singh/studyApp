import { useTranslation } from "react-i18next";
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Timer } from "lucide-react";
import type { AccuracyTimeBucket } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { scoreBandColor } from "@/lib/score-band";

export function AccuracyTimeCard({
  data,
  isLoading,
}: {
  data: AccuracyTimeBucket[] | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const hasData = (data ?? []).some((b) => b.count > 0);

  return (
    <SectionCard title={t("Profile.accuracyTimeTitle")} description={t("Profile.accuracyTimeDescription")}>
      {isLoading || !data ? (
        <Skeleton className="h-40 w-full" />
      ) : !hasData ? (
        <EmptyState
          icon={Timer}
          title={t("Profile.accuracyTimeEmptyTitle")}
          description={t("Profile.accuracyTimeEmptyDescription")}
        />
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
            <XAxis
              dataKey="bucket_label"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
            />
            <YAxis domain={[0, 100]} hide />
            <Tooltip
              formatter={(value, _name, payload) => {
                const count = (payload?.payload as AccuracyTimeBucket)?.count ?? 0;
                return [
                  count === 0 ? t("Profile.accuracyTimeNoData") : `${Math.round(Number(value))}%`,
                  t("Profile.accuracyTimeCount", { count }),
                ];
              }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--popover-foreground)",
              }}
            />
            {/* minPointSize keeps a zero-count bucket visible (as a flat muted
                sliver) rather than indistinguishable from a genuine 0%
                accuracy bar — the tooltip is what actually disambiguates. */}
            <Bar dataKey="accuracy_pct" radius={[6, 6, 0, 0]} isAnimationActive={false} minPointSize={3}>
              {data.map((bucket) => (
                <Cell key={bucket.bucket_label} fill={bucket.count === 0 ? "var(--muted)" : scoreBandColor(bucket.accuracy_pct)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </SectionCard>
  );
}
