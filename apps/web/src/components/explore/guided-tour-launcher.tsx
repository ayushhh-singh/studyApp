import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Compass } from "lucide-react";
import { GUIDED_TOUR_STOPS } from "@prayasup/shared";
import { SectionCard } from "@/components/ui-x/section-card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { useTourState, useUpdateTourState } from "@/hooks/use-tour";
import { guidedTourStopPath } from "@/lib/guided-tour";

/**
 * The guided tab tour's permanent launcher — lives on /explore alongside the
 * checklist and feature map so the tour is always re-triggerable, never only
 * a one-time welcome-moment offer. Label + action depend on persisted
 * progress: never started -> Take, paused mid-tour (backgrounded or an
 * explicit in-tour Skip) -> Resume from wherever it stopped, finished -> Retake.
 */
export function GuidedTourLauncher() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const tourQuery = useTourState();
  const updateTour = useUpdateTourState();

  const guidedTour = tourQuery.data?.tour_state.guided_tour;
  const status = guidedTour?.status ?? "not_started";

  async function start() {
    await updateTour.mutateAsync({ guided_tour_choice: "tour" });
    navigate(guidedTourStopPath(GUIDED_TOUR_STOPS[0], locale));
  }

  function resume() {
    navigate(guidedTourStopPath(GUIDED_TOUR_STOPS[guidedTour?.step_index ?? 0], locale));
  }

  const buttonLabel =
    status === "in_progress"
      ? t("Explore.tourLauncherResume")
      : status === "completed"
        ? t("Explore.tourLauncherRetake")
        : t("Explore.tourLauncherTake");

  return (
    <SectionCard className="border-primary/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Compass className="size-5" aria-hidden />
          </span>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold">{t("Explore.tourLauncherTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("Explore.tourLauncherDescription")}</p>
          </div>
        </div>
        <Button
          type="button"
          onClick={status === "in_progress" ? resume : start}
          disabled={updateTour.isPending}
        >
          {buttonLabel}
        </Button>
      </div>
    </SectionCard>
  );
}
