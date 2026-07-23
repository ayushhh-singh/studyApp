import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import type { ProfileAnalytics } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { DIMENSION_LABEL_KEYS } from "@/lib/rubric-labels";

/** A dimension is only worth calling out as "weakest" once there's more than a
 * single data point behind it — matches the same `count >= 2` bar the
 * Dashboard's own eval_dimension/drill_ready nudges already use. */
const MIN_EVALUATIONS_FOR_WEAKEST = 2;

function Stat({ value, label, color }: { value: string; label: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-display text-2xl font-extrabold tabular-nums tracking-tight" style={{ color }}>
        {value}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function scrollToAnalytics() {
  const target = document.getElementById("profile-analytics");
  if (!target) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
}

/**
 * A fast, at-a-glance summary sitting near the TOP of Profile, with a jump link
 * down to the full charts (score trajectory, weakness matrix, dimension radar,
 * improvement proof) that otherwise sit far down a long scrolling page and are
 * easy to never scroll to. Mirrors the Dashboard mentor-insight card's own
 * "summary now, detail on demand" pattern. Renders nothing for a brand-new
 * user with no real signal yet — no placeholder/empty stats.
 */
export function AnalyticsTeaserCard({ analytics, isLoading }: { analytics: ProfileAnalytics | undefined; isLoading: boolean }) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <SectionCard title={t("Profile.analyticsTeaserTitle")}>
        <Skeleton className="h-16 w-full" />
      </SectionCard>
    );
  }
  if (!analytics) return null;

  const trend = analytics.evaluation_trend;
  const latestPoint = trend.length > 0 ? trend[trend.length - 1] : null;

  const weakest =
    trend.length >= MIN_EVALUATIONS_FOR_WEAKEST && analytics.dimension_insights.length > 0
      ? analytics.dimension_insights.reduce((min, d) => (d.recent_avg_pct < min.recent_avg_pct ? d : min))
      : null;

  const rewriteGain =
    analytics.improvement_proof.avg_delta_pct !== null && analytics.improvement_proof.avg_delta_pct > 0
      ? analytics.improvement_proof.avg_delta_pct
      : null;

  if (!latestPoint && !weakest && rewriteGain === null) return null;

  return (
    <SectionCard title={t("Profile.analyticsTeaserTitle")}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {latestPoint && (
            <Stat value={`${Math.round(latestPoint.overall_pct)}%`} label={t("Profile.analyticsTeaserLatestScore")} color="var(--primary)" />
          )}
          {weakest && (
            <Stat
              value={t(DIMENSION_LABEL_KEYS[weakest.dimension_key])}
              label={t("Profile.analyticsTeaserWeakest")}
              color="var(--coral)"
            />
          )}
          {rewriteGain !== null && (
            <Stat value={`+${rewriteGain}%`} label={t("Profile.analyticsTeaserRewriteGain")} color="var(--tulsi)" />
          )}
        </div>
        <button
          type="button"
          onClick={scrollToAnalytics}
          className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          {t("Profile.analyticsTeaserViewFull")}
          <ChevronDown className="size-4" aria-hidden />
        </button>
      </div>
    </SectionCard>
  );
}
