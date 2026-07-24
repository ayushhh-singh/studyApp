/**
 * F5 Trends — lives on the "You" page (its coming-soon copy already promised
 * "Mood history ... will live here"). Calendar heatmap (by average mood, not
 * activity count), a 7/30/90-day line chart, emotion-frequency bars, and a
 * factor-correlation card with plain-language bilingual copy. Every section
 * has its own honest empty/insufficient-data state — no chart pretends to
 * have a trend when there isn't enough data yet.
 */
import { useMemo, useState } from "react";
import { CalendarDays, Smile, TrendingDown, TrendingUp } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { SUKOON_EMOTIONS, SUKOON_MOOD_FACTORS } from "@neev/shared";
import type { SukoonMoodAggregates, SukoonMoodFactorCorrelation } from "@neev/shared";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui-x/section-card";
import { EmptyState } from "@/components/ui-x/empty-state";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useMoodAggregates, useMoodHeatmap } from "@/sukoon/lib/use-sukoon-mood";
import { MOOD_EMOJI, useMoodLabel } from "@/sukoon/components/journal/journal-ui";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function emotionLabel(id: string, language: "hi" | "en"): string {
  const def = SUKOON_EMOTIONS.find((e) => e.id === id);
  if (!def) return id;
  return language === "hi" ? def.label_hi : def.label_en;
}
function factorLabel(id: string, language: "hi" | "en"): string {
  const def = SUKOON_MOOD_FACTORS.find((f) => f.id === id);
  if (!def) return id;
  return language === "hi" ? def.label_hi : def.label_en;
}

const RANGES: Array<7 | 30 | 90> = [7, 30, 90];

export function MoodTrends() {
  const { t, language } = useSukoonLanguage();
  const [range, setRange] = useState<7 | 30 | 90>(30);

  const aggregatesQuery = useMoodAggregates(range);
  const data = aggregatesQuery.data;
  const hasAny = (data?.total_entries ?? 0) > 0;

  return (
    <div className="flex flex-col gap-5">
      <MoodHeatmap />

      <SectionCard
        title={t("Sukoon.trends.lineChartTitle")}
        action={
          <div className="flex gap-1 rounded-full bg-muted p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                  range === r
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t("Sukoon.trends.rangeDays", { count: r })}
              </button>
            ))}
          </div>
        }
      >
        {aggregatesQuery.isPending || !data ? (
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        ) : !hasAny ? (
          <EmptyState
            icon={Smile}
            title={t("Sukoon.trends.emptyTitle")}
            description={t("Sukoon.trends.emptyDescription")}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <TrendLine daily={data.daily} />
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>
                {t("Sukoon.trends.avg7d")}:{" "}
                <strong className="text-foreground">
                  {data.avg_7d != null ? data.avg_7d.toFixed(1) : "—"}
                </strong>
              </span>
              <span>
                {t("Sukoon.trends.avg30d")}:{" "}
                <strong className="text-foreground">
                  {data.avg_30d != null ? data.avg_30d.toFixed(1) : "—"}
                </strong>
              </span>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t("Sukoon.trends.emotionsTitle")} description={t("Sukoon.trends.emotionsDescription")}>
        {aggregatesQuery.isPending || !data ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        ) : data.emotion_frequency.length === 0 ? (
          <EmptyState
            icon={Smile}
            title={t("Sukoon.trends.emotionsEmptyTitle")}
            description={t("Sukoon.trends.emotionsEmptyDescription")}
          />
        ) : (
          <EmotionFrequencyBars frequency={data.emotion_frequency} language={language} />
        )}
      </SectionCard>

      <SectionCard title={t("Sukoon.trends.correlationsTitle")} description={t("Sukoon.trends.correlationsDescription")}>
        {aggregatesQuery.isPending || !data ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
        ) : data.factor_correlations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {hasAny ? t("Sukoon.trends.correlationsNotEnough") : t("Sukoon.trends.correlationsEmpty")}
          </p>
        ) : (
          <div className="space-y-3">
            {data.factor_correlations.map((c) => (
              <CorrelationLine key={c.factor} correlation={c} language={language} t={t} />
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function TrendLine({ daily }: { daily: SukoonMoodAggregates["daily"] }) {
  const { language } = useSukoonLanguage();
  const points = daily
    .filter((d) => d.avg_score != null)
    .map((d, i) => ({ index: i, score: d.avg_score as number, date: d.date }));

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", {
      day: "numeric",
      month: "short",
    });

  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={points} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <YAxis domain={[1, 5]} hide />
        <Tooltip
          formatter={(value) => [Number(value).toFixed(1), ""]}
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
  );
}

function EmotionFrequencyBars({
  frequency,
  language,
}: {
  frequency: SukoonMoodAggregates["emotion_frequency"];
  language: "hi" | "en";
}) {
  const max = Math.max(...frequency.map((f) => f.count), 1);
  return (
    <div className="flex flex-col gap-2.5">
      {frequency.map((f) => (
        <div key={f.emotion} className="flex items-center gap-3">
          <span className="w-24 shrink-0 truncate text-sm text-foreground">
            {emotionLabel(f.emotion, language)}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-secondary"
              style={{ width: `${(f.count / max) * 100}%` }}
            />
          </div>
          <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
            {f.count}
          </span>
        </div>
      ))}
    </div>
  );
}

function CorrelationLine({
  correlation,
  language,
  t,
}: {
  correlation: SukoonMoodFactorCorrelation;
  language: "hi" | "en";
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const better = correlation.gap > 0;
  const Icon = better ? TrendingUp : TrendingDown;
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-border bg-card p-3">
      <Icon className={cn("mt-0.5 size-4 shrink-0", better ? "text-secondary" : "text-destructive")} />
      <p className="text-sm leading-relaxed text-foreground">
        {t("Sukoon.trends.correlationLine", {
          factor: factorLabel(correlation.factor, language),
          avgWith: correlation.avg_with.toFixed(1),
          avgWithout: correlation.avg_without.toFixed(1),
          samples: correlation.samples_with,
        })}
      </p>
    </div>
  );
}

function MoodHeatmap() {
  const { t, language } = useSukoonLanguage();
  const [month, setMonth] = useState(currentMonth());
  const heatmapQuery = useMoodHeatmap(month);
  const moodLabel = useMoodLabel();
  const byDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of heatmapQuery.data?.days ?? []) if (d.avg_score != null) m.set(d.date, d.avg_score);
    return m;
  }, [heatmapQuery.data]);

  const [y, mo] = month.split("-").map(Number);
  const firstDow = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${month}-${String(d).padStart(2, "0")}`);

  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(y, mo - 1 + delta, 1));
    setMonth(`${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const isFutureMonth = month >= currentMonth();
  const monthLabel = new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(
    language === "hi" ? "hi-IN" : "en-IN",
    { month: "long", year: "numeric", timeZone: "UTC" },
  );

  return (
    <SectionCard
      title={
        <span className="flex items-center gap-2">
          <CalendarDays className="size-4 text-secondary" />
          {monthLabel}
        </span>
      }
      action={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Sukoon.journal.heatmapPrevMonth")}
            onClick={() => shiftMonth(-1)}
          >
            ‹
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Sukoon.journal.heatmapNextMonth")}
            disabled={isFutureMonth}
            onClick={() => shiftMonth(1)}
          >
            ›
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} />;
          const avg = byDate.get(date);
          const day = Number(date.slice(-2));
          const intensity = avg != null ? Math.round(((avg - 1) / 4) * 100) : 0;
          return (
            <div
              key={date}
              title={avg != null ? `${date} · ${moodLabel(Math.round(avg))}` : date}
              className={cn(
                "flex aspect-square items-center justify-center rounded-md text-[11px] transition-colors",
                avg == null ? "bg-muted/60 text-muted-foreground" : "font-semibold text-secondary-foreground",
              )}
              style={
                avg != null
                  ? { backgroundColor: `color-mix(in srgb, var(--secondary) ${intensity}%, var(--muted))` }
                  : undefined
              }
            >
              {day}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        <span aria-hidden>{MOOD_EMOJI[1]}</span>
        {[0, 33, 66, 100].map((n) => (
          <span
            key={n}
            className="size-3 rounded-sm"
            style={{ backgroundColor: `color-mix(in srgb, var(--secondary) ${n}%, var(--muted))` }}
          />
        ))}
        <span aria-hidden>{MOOD_EMOJI[5]}</span>
      </div>
    </SectionCard>
  );
}
