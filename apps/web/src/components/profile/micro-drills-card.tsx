import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Sparkles, Trash2, Zap } from "lucide-react";
import type { DrillType } from "@neev/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Skeleton } from "@/components/ui-x/skeleton";
import { EmptyState } from "@/components/ui-x/empty-state";
import { Button } from "@/components/ui/button";
import { useCreateDrill, useDeleteDrill, useDrillHistory, useDrillRecommendation } from "@/hooks/use-micro-drill";
import { useLocale } from "@/hooks/use-locale";
import { DIMENSION_LABEL_KEYS } from "@/lib/rubric-labels";
import { useDrillSessionStore } from "@/stores/drill-session-store";
import { scoreBandColor } from "@/lib/score-band";
import { cn } from "@/lib/utils";

const DRILL_TYPES: DrillType[] = ["intro", "conclusion"];

export function MicroDrillsCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const { data: recommendation, isLoading: recLoading } = useDrillRecommendation();
  const { data: history, isLoading: historyLoading } = useDrillHistory();
  const createDrill = useCreateDrill();
  const deleteDrill = useDeleteDrill();
  const setSession = useDrillSessionStore((s) => s.setSession);

  function start(type: DrillType) {
    createDrill.mutate(type, {
      onSuccess: (session) => {
        setSession(session);
        navigate(`/${locale}/profile/drill`);
      },
    });
  }

  function remove(id: string) {
    if (window.confirm(t("MicroDrill.deleteConfirm"))) deleteDrill.mutate(id);
  }

  return (
    <SectionCard title={t("MicroDrill.title")} description={t("MicroDrill.description")}>
      <div className="flex flex-col gap-4">
        {recLoading || !recommendation ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="flex flex-col gap-2">
            {!recommendation.has_enough_data && (
              <p className="text-sm text-muted-foreground">{t("MicroDrill.notEnoughData")}</p>
            )}
            {recommendation.has_enough_data && recommendation.weakest_dimension && (
              <p className="text-sm text-muted-foreground">
                {t("MicroDrill.weakestDimension", { dimension: t(DIMENSION_LABEL_KEYS[recommendation.weakest_dimension]) })}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {DRILL_TYPES.map((type) => {
                const isRecommended = recommendation.recommended_type === type;
                return (
                  <Button
                    key={type}
                    type="button"
                    variant={isRecommended ? "default" : "outline"}
                    disabled={createDrill.isPending}
                    onClick={() => start(type)}
                    className="gap-1.5"
                  >
                    {isRecommended && <Sparkles className="size-4" aria-hidden />}
                    {type === "intro" ? t("MicroDrill.startIntro") : t("MicroDrill.startConclusion")}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">{t("MicroDrill.historyTitle")}</h3>
          {historyLoading || !history ? (
            <Skeleton className="h-16 w-full" />
          ) : history.length === 0 ? (
            <EmptyState
              icon={Zap}
              title={t("MicroDrill.historyEmptyTitle")}
              description={t("MicroDrill.historyEmptyDescription")}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              {history.slice(0, 10).map((session) => (
                <div
                  key={session.id}
                  className="group flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">
                      {session.drill_type === "intro" ? t("MicroDrill.typeIntro") : t("MicroDrill.typeConclusion")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(session.created_at).toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN")}
                    </span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className={cn("font-display text-lg")}
                      style={{ color: session.overall_pct !== null ? scoreBandColor(session.overall_pct) : undefined }}
                    >
                      {session.overall_pct !== null ? `${Math.round(session.overall_pct)}%` : "—"}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(session.id)}
                      disabled={deleteDrill.isPending}
                      aria-label={t("MicroDrill.delete")}
                      title={t("MicroDrill.delete")}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-coral/10 hover:text-coral focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring md:opacity-0 md:group-hover:opacity-100"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
