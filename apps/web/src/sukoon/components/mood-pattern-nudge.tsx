import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { HeartHandshake, PenLine, MessageCircleHeart, Wind, X } from "lucide-react";
import type { SukoonExerciseType, SukoonMoodPatternTier } from "@neev/shared";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonProfile } from "@/sukoon/lib/use-sukoon-profile";
import { useMoodPattern } from "@/sukoon/lib/use-sukoon-mood";
import { useExercises } from "@/sukoon/lib/use-sukoon-exercises";
import { SUKOON_TOOL_ICONS, toolPlayerPath } from "@/sukoon/lib/tool-icons";
import { CrisisHelplineList } from "@/sukoon/components/crisis-helpline-list";

/**
 * <MoodPatternNudge/> — the PROACTIVE bridge surface (F5×F6, Ebb-inspired).
 * When the conservative backend detector (`GET /mood/pattern`) finds a genuine
 * declining trend in the user's own check-ins, this calm card gently reaches
 * toward support BEFORE being asked: it names the trend softly and
 * non-clinically (never a condition), offers ONE specific calming tool matched
 * to the recent feeling, plus talk-it-out / write-it-out paths — and, only at
 * the sustained-low `care` tier, a warm early helpline reminder (earlier than
 * the crisis takeover, framed as a kind option, never an alarm).
 *
 * DESIGN: stays strictly on the CALM palette — this is a low-mood context, so
 * the joy accent is forbidden here (docs/sukoon-design.md). `soft` uses the
 * teal accent; `care` uses the same gentle indigo/primary family as the
 * moderate crisis inline card (never destructive/red). Dismissible, and
 * de-duped via localStorage so it never re-nags (a 3-day cooldown, re-shown
 * only if the trend deepens soft→care). Renders nothing when tier is "none".
 */

const DISMISS_KEY = "sukoon-mood-nudge-dismissed";
const COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const TIER_RANK: Record<Exclude<SukoonMoodPatternTier, "none">, number> = { soft: 1, care: 2 };

interface Dismissed {
  tier: "soft" | "care";
  at: number;
}

function readDismissed(): Dismissed | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Dismissed;
    if ((parsed.tier === "soft" || parsed.tier === "care") && typeof parsed.at === "number") {
      return parsed;
    }
  } catch {
    /* storage/JSON unavailable — treat as not dismissed */
  }
  return null;
}

/** Hidden only inside the cooldown AND when the trend hasn't deepened since. */
function isSuppressed(tier: "soft" | "care", d: Dismissed | null): boolean {
  if (!d) return false;
  if (Date.now() - d.at >= COOLDOWN_MS) return false;
  return TIER_RANK[tier] <= TIER_RANK[d.tier];
}

/** A per-tool CTA label key (only breathing/grounding are ever suggested today,
 *  but every type maps so a future mapping change can't render a blank CTA). */
function toolCtaKey(type: SukoonExerciseType): string {
  switch (type) {
    case "breathing":
      return "Sukoon.moodNudge.ctaBreathe";
    case "grounding":
      return "Sukoon.moodNudge.ctaGround";
    default:
      return "Sukoon.moodNudge.ctaTool";
  }
}

export function MoodPatternNudge({
  className,
  hideSaathiCta,
}: {
  className?: string;
  /** On the Saathi screen itself the "talk to Saathi" CTA is redundant. */
  hideSaathiCta?: boolean;
}) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { session } = useAuth();

  const profileQuery = useSukoonProfile({ enabled: !!session });
  const restricted = profileQuery.data?.profile?.restricted_mode ?? false;

  const patternQuery = useMoodPattern({ enabled: !!session });
  const pattern = patternQuery.data ?? null;
  const tier = pattern?.tier ?? "none";

  const exercisesQuery = useExercises({ enabled: !!session && tier !== "none" });

  // Dismissal is read once at mount (a fresh card re-evaluates on the next
  // visit); a click updates local state so it disappears immediately.
  const [dismissed, setDismissed] = useState<Dismissed | null>(() => readDismissed());

  // Resolve a concrete, unlocked exercise of the suggested type for the deep
  // link (prefer free/unlocked so a tap never dead-ends at a paywall); fall
  // back to the tools grid if none is loaded yet.
  const toolPath = useMemo(() => {
    const type = pattern?.suggested_exercise_type ?? null;
    const list = exercisesQuery.data?.exercises ?? [];
    if (type) {
      const match = list.find((e) => e.type === type && !e.locked) ?? list.find((e) => e.type === type);
      if (match) return `${base}/${toolPlayerPath(type, match.id)}`;
    }
    return `${base}/tools`;
  }, [pattern?.suggested_exercise_type, exercisesQuery.data, base]);

  if (tier === "none") return null;
  if (isSuppressed(tier, dismissed)) return null;

  const suggestedType = pattern?.suggested_exercise_type ?? "breathing";
  const ToolIcon = SUKOON_TOOL_ICONS[suggestedType] ?? Wind;
  const care = tier === "care";

  const onDismiss = () => {
    const next: Dismissed = { tier, at: Date.now() };
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — still hide for this session via state */
    }
    setDismissed(next);
  };

  return (
    <section
      lang={language}
      aria-label={t("Sukoon.moodNudge.label")}
      className={cn(
        "sukoon-rise relative flex flex-col gap-4 rounded-2xl border p-4",
        // Calm only — teal for a soft dip, gentle indigo for a sustained low.
        care ? "border-primary/25 bg-primary/5" : "border-secondary/30 bg-secondary/5",
        className,
      )}
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("Sukoon.moodNudge.dismiss")}
        className="absolute right-2.5 top-2.5 flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <span
          className={cn(
            "mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full",
            care ? "bg-primary/10 text-primary" : "bg-secondary/15 text-secondary",
          )}
          aria-hidden
        >
          <HeartHandshake className="size-5" />
        </span>
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground">
            {t(care ? "Sukoon.moodNudge.careTitle" : "Sukoon.moodNudge.softTitle")}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(care ? "Sukoon.moodNudge.careBody" : "Sukoon.moodNudge.softBody")}
          </p>
        </div>
      </div>

      {/* One specific tool, matched to the recent feeling, plus gentle paths. */}
      <div className="flex flex-wrap gap-2">
        <NudgeAction to={toolPath} icon={ToolIcon} label={t(toolCtaKey(suggestedType))} primary={care} />
        {!hideSaathiCta && !restricted ? (
          <NudgeAction to={`${base}/saathi`} icon={MessageCircleHeart} label={t("Sukoon.moodNudge.ctaTalk")} />
        ) : null}
        <NudgeAction to={`${base}/journal`} icon={PenLine} label={t("Sukoon.moodNudge.ctaWrite")} />
      </div>

      {/* care tier only — a warm, early helpline offer (earlier than crisis). */}
      {care ? (
        <div className="flex flex-col gap-2.5 rounded-xl border border-primary/20 bg-card/60 p-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("Sukoon.moodNudge.careHelpline")}
          </p>
          <CrisisHelplineList limit={2} />
        </div>
      ) : null}
    </section>
  );
}

function NudgeAction({
  to,
  icon: Icon,
  label,
  primary,
}: {
  to: string;
  icon: typeof Wind;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex min-h-11 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        primary
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border bg-card text-foreground hover:bg-accent",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      {label}
    </Link>
  );
}
