import { Link } from "react-router";
import { CheckCircle2, Lock, Milestone } from "lucide-react";
import type { SukoonJourney } from "@neev/shared";
import { cn } from "@/lib/utils";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { ProgressRing } from "./progress-ring";

/** Sukoon F7 — one catalog card: title/description, day count, a progress
 *  ring (0 pre-start, partial mid-journey, a checkmark once complete), and a
 *  locked badge when premium + free tier (mirrors ExerciseCard's pattern). */
export function JourneyCard({ journey, base }: { journey: SukoonJourney; base: string }) {
  const { t, language } = useSukoonLanguage();
  const title = language === "hi" ? journey.title_hi : journey.title_en;
  const description = language === "hi" ? journey.description_hi : journey.description_en;
  const done = !!journey.progress?.completed_at;
  const pct =
    journey.total_steps > 0 && journey.progress
      ? (journey.progress.completed_step_ids.length / journey.total_steps) * 100
      : 0;

  return (
    <Link
      to={`${base}/journeys/${journey.slug}`}
      className={cn(
        "group flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 transition-colors duration-300",
        "hover:border-secondary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary">
          <Milestone className="size-5" aria-hidden />
        </span>
        {journey.locked ? (
          <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            {t("Sukoon.tools.premiumBadge")}
          </span>
        ) : (
          <div className="relative flex items-center justify-center">
            <ProgressRing value={done ? 100 : pct} size={36} strokeWidth={3.5} />
            {done ? <CheckCircle2 className="absolute size-4 text-secondary" aria-hidden /> : null}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="mt-auto flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {journey.days === 1
            ? t("Sukoon.journeys.singleSession")
            : t("Sukoon.journeys.dayCount", { count: journey.days })}
        </span>
        {journey.progress && !done ? (
          <>
            <span aria-hidden>·</span>
            <span>{t("Sukoon.journeys.continueChip")}</span>
          </>
        ) : null}
      </div>
    </Link>
  );
}
