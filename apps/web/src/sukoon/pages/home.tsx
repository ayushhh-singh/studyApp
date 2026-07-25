import { Link, useParams } from "react-router";
import { ClipboardCheck, MessageCircleHeart, Wind } from "lucide-react";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useTrackSukoonFeatureView } from "@/sukoon/lib/use-sukoon-analytics";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { MoodHomeCard } from "@/sukoon/components/mood-home-card";
import { ExamEveJourneyCard } from "@/sukoon/components/journeys/exam-eve-journey-card";
import { MoodPatternNudge } from "@/sukoon/components/mood-pattern-nudge";
import { JourneysHomeCard } from "@/sukoon/components/journeys/journeys-home-card";
import { SukoonGardenCard } from "@/sukoon/components/garden/sukoon-garden-card";
import { CheckinCard } from "@/sukoon/components/checkin/checkin-card";
import { InsightsFeed } from "@/sukoon/components/insights/insights-feed";

/** Time-of-day greeting key — calm, never exclamatory. */
function greetingKey(hour: number): string {
  if (hour >= 22 || hour < 5) return "Sukoon.home.greetNight";
  if (hour < 12) return "Sukoon.home.greetMorning";
  if (hour < 17) return "Sukoon.home.greetAfternoon";
  return "Sukoon.home.greetEvening";
}

/**
 * Sukoon Home — a calm, deliberately spacious entry point. The overhaul trades
 * the old dense 6-card stack for a quiet greeting, ONE prominent row of
 * essential actions (check in · breathe · Saathi), and the richer cards demoted
 * into a roomy "your space" section below. Whitespace here is the point: this
 * is the first breath, not a control panel. The essential-actions row uses the
 * CALM teal accent — Home is a neutral surface, so it never takes the warm joy
 * accent (that's reserved for actual positive moments like a completed session).
 */
export function Component() {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { session } = useAuth();
  useTrackSukoonFeatureView("home");

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10" lang={language}>
      {/* Greeting hero — generous top padding is intentional breathing room. */}
      <header className="sukoon-rise flex flex-col gap-2 pt-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {t(greetingKey(new Date().getHours()))}
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-muted-foreground">{t("Sukoon.homeSub")}</p>
      </header>

      {/* Exam-eve is a time-sensitive nudge; it self-hides unless imminent. */}
      {session ? <ExamEveJourneyCard /> : null}

      {/* Proactive bridge: self-hides unless a genuine declining mood trend is
          detected (conservative). Calm, dismissible — never nags. */}
      {session ? <MoodPatternNudge /> : null}

      {/* THE essential actions — the only things surfaced prominently. */}
      <nav aria-label={t("Sukoon.home.quickActionsLabel")} className="sukoon-rise-slow grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickAction
          to={`${base}/mood`}
          icon={ClipboardCheck}
          title={t("Sukoon.home.quickCheckIn")}
          sub={t("Sukoon.home.quickCheckInSub")}
        />
        <QuickAction
          to={`${base}/tools`}
          icon={Wind}
          title={t("Sukoon.home.quickBreathe")}
          sub={t("Sukoon.home.quickBreatheSub")}
        />
        <QuickAction
          to={`${base}/saathi`}
          icon={MessageCircleHeart}
          title={t("Sukoon.home.quickSaathi")}
          sub={t("Sukoon.home.quickSaathiSub")}
        />
      </nav>

      {/* Everything else lives in a calmer, roomier secondary section. */}
      {session ? (
        <section className="flex flex-col gap-6" aria-label={t("Sukoon.home.yourSpace")}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("Sukoon.home.yourSpace")}
          </h2>
          <MoodHomeCard />
          <CheckinCard />
          <SukoonGardenCard />
          <JourneysHomeCard />
          <InsightsFeed max={1} />
        </section>
      ) : null}
    </div>
  );
}

/** A single calm, large-tap-target entry point in the essential-actions row. */
function QuickAction({
  to,
  icon: Icon,
  title,
  sub,
}: {
  to: string;
  icon: typeof Wind;
  title: string;
  sub: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "group flex min-h-24 flex-col justify-between gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm",
        "transition-colors duration-300 hover:border-secondary/50 hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span
        className="flex size-11 items-center justify-center rounded-full bg-secondary/15 text-secondary motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-105"
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs leading-snug text-muted-foreground">{sub}</span>
      </span>
    </Link>
  );
}
