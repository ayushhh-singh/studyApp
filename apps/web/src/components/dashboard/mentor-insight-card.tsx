import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { useMentorInsights, useDismissInsight } from "@/hooks/use-mentor";
import { Button } from "@/components/ui/button";

/**
 * At most ONE proactive mentor nudge on the dashboard. The mentor never messages
 * first — it surfaces a dismissible card derived from the learner profile.
 */
export function MentorInsightCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const { data } = useMentorInsights();
  const dismiss = useDismissInsight();

  const insight = data?.insights?.[0];
  if (!insight) return null;

  return (
    <section className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles className="size-4" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-primary">{t("Mentor.insightLabel")}</p>
        <p className="mt-1 text-sm">{insight.insight_i18n[locale]}</p>
        {insight.cta_link && (
          <Button asChild variant="outline" size="xs" className="mt-2">
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
    </section>
  );
}
