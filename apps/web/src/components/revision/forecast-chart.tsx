import { useTranslation } from "react-i18next";

function weekdayLabel(dateStr: string, locale: string): string {
  const d = new Date(`${dateStr}T00:00:00+05:30`);
  return new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", { weekday: "short" }).format(d);
}

/** 7-day due-count forecast — day 0 (today) absorbs overdue backlog, matching srs.ts's getStats. */
export function ForecastChart({ forecast }: { forecast: { date: string; count: number }[] }) {
  const { t, i18n } = useTranslation();
  const max = Math.max(1, ...forecast.map((d) => d.count));

  return (
    <div
      className="flex items-end gap-2 rounded-xl border border-border bg-card p-4"
      role="img"
      aria-label={t("Revision.forecast")}
    >
      {forecast.map((day, i) => {
        const pct = day.count > 0 ? Math.max(8, (day.count / max) * 100) : 0;
        return (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-1.5">
            <span className="text-xs font-semibold tabular-nums text-card-foreground">{day.count}</span>
            <div className="flex h-16 w-full items-end overflow-hidden rounded-md bg-muted">
              <div
                className="w-full rounded-md bg-primary transition-[height] duration-300"
                style={{ height: `${pct}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground">
              {i === 0 ? t("Revision.today") : weekdayLabel(day.date, i18n.language)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
