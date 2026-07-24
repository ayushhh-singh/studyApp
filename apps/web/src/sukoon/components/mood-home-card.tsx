/**
 * F5 — Sukoon Home's "today's check-in status" card + last-7-days strip.
 */
import { Link, useParams } from "react-router";
import { Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/ui-x/section-card";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useMoodToday, useMoodAggregates } from "@/sukoon/lib/use-sukoon-mood";
import { MOOD_EMOJI, useMoodLabel } from "@/sukoon/components/journal/journal-ui";

export function MoodHomeCard() {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const moodLabel = useMoodLabel();

  const todayQuery = useMoodToday();
  const weekQuery = useMoodAggregates(7);

  const primary = todayQuery.data?.primary ?? null;
  const dayLabel = (iso: string) =>
    new Date(iso).toLocaleDateString(language === "hi" ? "hi-IN" : "en-IN", { weekday: "narrow" });

  return (
    <SectionCard title={t("Sukoon.mood.homeTitle")}>
      <div className="flex flex-col gap-4">
        {todayQuery.isPending ? (
          <div className="h-16 animate-pulse rounded-xl bg-muted" />
        ) : primary ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl" aria-hidden>
                {MOOD_EMOJI[primary.score]}
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">{moodLabel(primary.score)}</p>
                <p className="text-xs text-muted-foreground">{t("Sukoon.mood.checkedInToday")}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link to={`${base}/mood`}>{t("Sukoon.mood.edit")}</Link>
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-10 items-center justify-center rounded-full bg-secondary/15 text-secondary"
                aria-hidden
              >
                <Smile className="size-5" />
              </span>
              <p className="text-sm text-muted-foreground">{t("Sukoon.mood.notCheckedInToday")}</p>
            </div>
            <Button size="sm" asChild>
              <Link to={`${base}/mood`}>{t("Sukoon.mood.checkIn")}</Link>
            </Button>
          </div>
        )}

        {weekQuery.data && weekQuery.data.total_entries > 0 ? (
          <div className="flex items-center justify-between gap-1.5 border-t border-border pt-3">
            {weekQuery.data.daily.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-base",
                    d.avg_score == null ? "bg-muted" : "bg-secondary/15",
                  )}
                  aria-hidden
                >
                  {d.avg_score != null ? MOOD_EMOJI[Math.round(d.avg_score)] : ""}
                </span>
                <span className="text-[10px] text-muted-foreground">{dayLabel(d.date)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
