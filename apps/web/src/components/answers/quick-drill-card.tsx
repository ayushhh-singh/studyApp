import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Zap } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useCreateDrill, useDrillRecommendation } from "@/hooks/use-micro-drill";
import { useLocale } from "@/hooks/use-locale";
import { DIMENSION_LABEL_KEYS } from "@/lib/rubric-labels";
import { useDrillSessionStore } from "@/stores/drill-session-store";
import { usePaywallStore, toPaywallFeature } from "@/stores/paywall-store";

/**
 * A compact entry point into micro-drills, right alongside every other
 * answer-writing action on the Answers hub — the full drill history/manage
 * view stays Profile-only, this is just "start one now" without a detour.
 */
export function QuickDrillCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const openPaywall = usePaywallStore((s) => s.openPaywall);
  const { data: recommendation, isLoading } = useDrillRecommendation();
  const createDrill = useCreateDrill();
  const setSession = useDrillSessionStore((s) => s.setSession);

  function start() {
    const type = recommendation?.recommended_type ?? "intro";
    createDrill.mutate(type, {
      onSuccess: (session) => {
        setSession(session);
        navigate(`/${locale}/profile/drill`);
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 402) openPaywall(toPaywallFeature(err.feature));
      },
    });
  }

  return (
    <SectionCard title={t("Answers.quickDrillTitle")} description={t("Answers.quickDrillDescription")}>
      {isLoading ? (
        <Skeleton className="h-10 w-40" />
      ) : (
        <div className="flex flex-col gap-2">
          {recommendation?.has_enough_data && recommendation.weakest_dimension && (
            <p className="text-sm text-muted-foreground">
              {t("MicroDrill.weakestDimension", { dimension: t(DIMENSION_LABEL_KEYS[recommendation.weakest_dimension]) })}
            </p>
          )}
          <Button type="button" onClick={start} disabled={createDrill.isPending} className="w-fit gap-1.5">
            <Zap className="size-4" aria-hidden />
            {t("Answers.quickDrillCta")}
          </Button>
        </div>
      )}
    </SectionCard>
  );
}
