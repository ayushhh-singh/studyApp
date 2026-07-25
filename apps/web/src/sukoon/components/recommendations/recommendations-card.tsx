import { Link, useParams } from "react-router";
import { ChevronRight, Lock, Route, Sparkles } from "lucide-react";
import {
  SUKOON_EMOTIONS,
  type SukoonRecommendation,
  type SukoonRecommendationReason,
} from "@neev/shared";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useSukoonLanguage } from "@/sukoon/lib/use-sukoon-language";
import { useSukoonRecommendations } from "@/sukoon/lib/use-sukoon-recommendations";
import { SUKOON_TOOL_ICONS, toolPlayerPath } from "@/sukoon/lib/tool-icons";

/**
 * <RecommendationsCard/> — the "For you" surface. Ranks the static content
 * library (F6 exercises + F7 journeys) by GENUINE semantic similarity to the
 * user's recent mood/journal signal (GET /recommendations), and shows each with
 * a short, HONEST, bilingual reason line ("because sleep has come up in your
 * check-ins") so personalisation reads as considerate, never a black box — and
 * never overclaims ("because you mentioned X", never "you need X").
 *
 * DESIGN: stays on the CALM palette (this is a supportive, low-key surface — no
 * joy accent). Self-hides when there's nothing to show. When the user has no
 * signal yet, the heading softens to a calm "a place to start" rather than
 * implying a personalisation that didn't happen.
 */

const EMOTION_BY_ID = new Map(SUKOON_EMOTIONS.map((e) => [e.id, e]));

/** Resolve a reason CODE to its localised, considerate sentence. */
function useReasonText() {
  const { t, language } = useSukoonLanguage();
  return (reason: SukoonRecommendationReason): string => {
    switch (reason.kind) {
      case "factor":
        return reason.factor
          ? t(`Sukoon.recommendations.reason.factor.${reason.factor}`)
          : t("Sukoon.recommendations.reason.general");
      case "emotion": {
        const emo = reason.emotion ? EMOTION_BY_ID.get(reason.emotion) : null;
        const label = emo ? (language === "hi" ? emo.label_hi : emo.label_en).toLowerCase() : "";
        return label
          ? t("Sukoon.recommendations.reason.emotion", { emotion: label })
          : t("Sukoon.recommendations.reason.general");
      }
      case "journal_theme":
        return reason.tag
          ? t("Sukoon.recommendations.reason.journalTheme", { tag: reason.tag })
          : t("Sukoon.recommendations.reason.general");
      case "low_mood":
        return t("Sukoon.recommendations.reason.lowMood");
      case "getting_started":
        return t("Sukoon.recommendations.reason.gettingStarted");
      default:
        return t("Sukoon.recommendations.reason.general");
    }
  };
}

export function RecommendationsCard({ limit = 4, className }: { limit?: number; className?: string }) {
  const { t, language } = useSukoonLanguage();
  const { locale } = useParams<{ locale?: string }>();
  const base = locale ? `/${locale}/sukoon` : "";
  const { session } = useAuth();
  const reasonText = useReasonText();

  const query = useSukoonRecommendations(limit, { enabled: !!session });
  const recommendations = query.data?.recommendations ?? [];
  const signalAvailable = query.data?.signal_available ?? false;

  // Self-hide when there's nothing to show (also while the first load is
  // pending, so the calm layout never flashes an empty box then fills).
  if (recommendations.length === 0) return null;

  return (
    <section lang={language} aria-label={t("Sukoon.recommendations.title")} className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-secondary" aria-hidden />
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(signalAvailable ? "Sukoon.recommendations.title" : "Sukoon.recommendations.titleGeneric")}
        </h2>
      </div>

      <ul className="flex flex-col gap-2.5">
        {recommendations.map((rec) => (
          <li key={`${rec.content_kind}:${rec.content_id}`}>
            <RecommendationRow rec={rec} base={base} language={language} reason={reasonText(rec.reason)} lockedLabel={t("Sukoon.recommendations.locked")} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecommendationRow({
  rec,
  base,
  language,
  reason,
  lockedLabel,
}: {
  rec: SukoonRecommendation;
  base: string;
  language: "hi" | "en";
  reason: string;
  lockedLabel: string;
}) {
  const to =
    rec.content_kind === "journey"
      ? `${base}/journeys/${rec.slug ?? rec.content_ref}`
      : `${base}/${toolPlayerPath(rec.exercise_type ?? "breathing", rec.content_id)}`;
  const Icon = rec.content_kind === "journey" ? Route : SUKOON_TOOL_ICONS[rec.exercise_type ?? "breathing"];
  const title = language === "hi" ? rec.title_hi : rec.title_en;

  return (
    <Link
      to={to}
      className={cn(
        "group flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm",
        "transition-colors duration-300 hover:border-secondary/50 hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary/15 text-secondary"
        aria-hidden
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{title}</span>
          {rec.locked ? (
            <span
              className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              title={lockedLabel}
            >
              <Lock className="size-2.5" aria-hidden />
              {lockedLabel}
            </span>
          ) : null}
        </span>
        {/* The honest, considerate reasoning line — must stay fully readable
            (never truncated), so it wraps to at most two lines rather than
            cutting off mid-sentence, which would undermine the whole point. */}
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">{reason}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}
