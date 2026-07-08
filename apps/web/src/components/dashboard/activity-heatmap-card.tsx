import { useTranslation } from "react-i18next";
import type { HeatmapDay } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { useActivityHeatmap } from "@/hooks/use-engagement";
import { cn } from "@/lib/utils";

function cellBackground(day: HeatmapDay): string {
  if (day.is_future) return "transparent";
  if (day.count === 0) return "var(--muted)";
  const t = day.count >= 6 ? 1 : day.count >= 3 ? 0.7 : 0.42;
  return `color-mix(in srgb, var(--tulsi) ${Math.round(t * 100)}%, var(--muted))`;
}

function LegendCell({ background, className }: { background: string; className?: string }) {
  return <span className={cn("inline-block size-3 rounded-[3px]", className)} style={{ background }} />;
}

export function ActivityHeatmapCard({ weeks }: { weeks?: number } = {}) {
  const { t } = useTranslation();
  const { data, isLoading } = useActivityHeatmap(weeks);

  return (
    <SectionCard
      title={t("Dashboard.heatmapTitle")}
      action={
        data ? (
          <span className="text-xs font-semibold text-marigold-foreground">
            {t("Dashboard.perfectDaysCount", { count: data.perfect_days_total })}
          </span>
        ) : undefined
      }
    >
      {isLoading || !data ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("Dashboard.heatmapIntro")}</p>
          <div className="overflow-x-auto pb-1">
            <div className="grid grid-flow-col grid-rows-7 gap-1" style={{ width: "max-content" }}>
              {data.days.map((day) => (
                <span
                  key={day.date}
                  title={
                    day.is_future
                      ? undefined
                      : `${day.date} · ${t("Dashboard.heatmapActivity", { count: day.count })}${day.is_perfect ? ` · ${t("Dashboard.perfectDay")}` : ""}`
                  }
                  aria-hidden={day.is_future}
                  className={cn(
                    "size-3.5 rounded-[3px]",
                    day.is_perfect && "ring-2 ring-marigold ring-offset-1 ring-offset-card",
                  )}
                  style={{ background: cellBackground(day) }}
                />
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              {t("Dashboard.heatmapLess")}
              <LegendCell background="var(--muted)" />
              <LegendCell background="color-mix(in srgb, var(--tulsi) 42%, var(--muted))" />
              <LegendCell background="color-mix(in srgb, var(--tulsi) 70%, var(--muted))" />
              <LegendCell background="var(--tulsi)" />
              {t("Dashboard.heatmapMore")}
            </span>
            <span className="flex items-center gap-1.5">
              <LegendCell background="var(--tulsi)" className="ring-2 ring-marigold ring-offset-1 ring-offset-card" />
              {t("Dashboard.perfectDay")}
            </span>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
