import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { X } from "lucide-react";
import { GUIDED_TOUR_STOPS, type GuidedTourStopKey } from "@prayasup/shared";
import { Button } from "@/components/ui/button";
import { SpotlightFrame, useSpotlightRect } from "@/components/ui-x/spotlight";
import { useLocale } from "@/hooks/use-locale";
import { useTourState, useUpdateTourState } from "@/hooks/use-tour";
import { guidedTourStopPath } from "@/lib/guided-tour";

const STOP_MESSAGE_KEY: Record<GuidedTourStopKey, string> = {
  learn: "GuidedTour.stopMessage_learn",
  practice: "GuidedTour.stopMessage_practice",
  answers: "GuidedTour.stopMessage_answers",
  revision: "GuidedTour.stopMessage_revision",
  doubts: "GuidedTour.stopMessage_doubts",
  current_affairs: "GuidedTour.stopMessage_current_affairs",
  scoreboard: "GuidedTour.stopMessage_scoreboard",
  community: "GuidedTour.stopMessage_community",
  explore: "GuidedTour.stopMessage_explore",
};

/**
 * The opt-in guided tab tour (layer 2b): navigates through 9 real routes in
 * sequence, one spotlight coachmark per stop, manual Next/Finish only (no
 * auto-advance). Mounted once in app-shell so it survives every in-app
 * navigation; renders nothing unless tour_state.guided_tour.status is
 * "in_progress" AND the current route is exactly the stop it's paused at —
 * that single condition is what makes it resumable (reload, background, or
 * an explicit "Skip tour" all just pause it in place) without ever
 * auto-launching for someone who hasn't opted in via the welcome choice or
 * /explore's launcher.
 */
export function GuidedTourCoachmark() {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const tourQuery = useTourState();
  const updateTour = useUpdateTourState();
  const [dismissedLocally, setDismissedLocally] = useState(false);

  const guidedTour = tourQuery.data?.tour_state.guided_tour;
  const stepIndex = guidedTour?.step_index ?? 0;
  const currentStop = GUIDED_TOUR_STOPS[stepIndex];
  const isActive = guidedTour?.status === "in_progress";
  const onStopRoute = isActive && location.pathname === guidedTourStopPath(currentStop, locale);
  const shouldShow = onStopRoute && !dismissedLocally;

  // A route change (including the Next-triggered one) always gets a fresh
  // chance to show — "Skip tour" only pauses the CURRENT stop, it never
  // permanently hides the rest of the tour.
  useEffect(() => {
    setDismissedLocally(false);
  }, [location.pathname]);

  const rect = useSpotlightRect(
    () => document.querySelector<HTMLElement>(`[data-tour-anchor="${currentStop}"]`),
    shouldShow,
  );

  if (!shouldShow || !rect) return null;

  const isLast = stepIndex === GUIDED_TOUR_STOPS.length - 1;

  async function handleNext() {
    const wasLast = isLast;
    await updateTour.mutateAsync({ guided_tour_advance: true });
    if (!wasLast) navigate(guidedTourStopPath(GUIDED_TOUR_STOPS[stepIndex + 1], locale));
  }

  const message = t(STOP_MESSAGE_KEY[currentStop]);

  return (
    <SpotlightFrame rect={rect} ariaLabel={message}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold tabular-nums text-muted-foreground">
          {t("GuidedTour.stepCounter", { current: stepIndex + 1, total: GUIDED_TOUR_STOPS.length })}
        </span>
        <button
          type="button"
          aria-label={t("GuidedTour.skipTour")}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setDismissedLocally(true)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <p className="mt-1 text-sm leading-relaxed">{message}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setDismissedLocally(true)}>
          {t("GuidedTour.skipTour")}
        </Button>
        <Button type="button" size="sm" onClick={handleNext} disabled={updateTour.isPending}>
          {isLast ? t("GuidedTour.finish") : t("GuidedTour.next")}
        </Button>
      </div>
    </SpotlightFrame>
  );
}
