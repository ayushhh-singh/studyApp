import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, TrendingUp, X, ArrowRight } from "lucide-react";
import type { MentorInsight } from "@neev/shared";
import { useLocale } from "@/hooks/use-locale";
import { useMentorInsights, useDismissInsight } from "@/hooks/use-mentor";
import { Button } from "@/components/ui/button";

/**
 * A nudge's kind decides its accent (marigold = something to fix, tulsi = good
 * news, primary = general momentum) — NOT the CTA button, which always stays
 * the app's standard filled action color so "this is clickable" reads
 * consistently everywhere. Unknown/future kinds fall back to primary.
 */
const POSITIVE_KINDS = new Set(["rewrite_improvement"]);

/** The rail color is applied via inline style (not a `border-l-*` class) so it
 * can never lose a Tailwind cascade tie-break against the card's own
 * `border-border` — inline style always wins unambiguously. */
function accentFor(kind: string): { rail: string; iconBg: string; iconFg: string; label: string; Icon: typeof Sparkles } {
  if (POSITIVE_KINDS.has(kind)) {
    return { rail: "var(--tulsi)", iconBg: "bg-tulsi/15", iconFg: "text-tulsi", label: "text-tulsi", Icon: TrendingUp };
  }
  if (kind === "exam_proximity") {
    return { rail: "var(--primary)", iconBg: "bg-primary/15", iconFg: "text-primary", label: "text-primary", Icon: Sparkles };
  }
  return { rail: "var(--marigold)", iconBg: "bg-marigold/15", iconFg: "text-marigold", label: "text-marigold", Icon: Sparkles };
}

/**
 * At most ONE proactive mentor nudge on the dashboard. The mentor never messages
 * first — it surfaces a dismissible card derived from the learner profile.
 * Given a colored left accent + elevation (not just a flat tinted box) so it
 * reads as a flagged action rather than blending into the page chrome, plus a
 * one-time entrance so it's noticed on load without ever looping/nagging.
 */
export function MentorInsightCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data } = useMentorInsights();
  const dismiss = useDismissInsight();
  const reduceMotion = useReducedMotion();

  const insight = data?.insights?.[0] as MentorInsight | undefined;
  if (!insight) return null;

  const accent = accentFor(insight.kind);

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 shadow-sm"
      style={{ borderLeftColor: accent.rail, borderLeftWidth: 4 }}
    >
      <div className={`mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full ${accent.iconBg} ${accent.iconFg}`}>
        <accent.Icon className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-semibold uppercase tracking-wide ${accent.label}`}>{t("Mentor.insightLabel")}</p>
        <p className="mt-1 text-sm">{insight.insight_i18n[locale]}</p>
        {insight.cta_link && (
          <Button asChild variant="default" size="sm" className="mt-3">
            <Link to={`/${locale}${insight.cta_link}`}>
              {t("Mentor.insightCta")} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss.mutate(insight.id)}
        aria-label={t("Mentor.dismiss")}
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden />
      </button>
    </motion.section>
  );
}
