import { GUIDED_TOUR_STOPS, type GuidedTourStopKey } from "@neev/shared";
import type { Locale } from "@/lib/locale";

export { GUIDED_TOUR_STOPS };

/** The real route each stop navigates to — checked against router.tsx's actual paths. */
const STOP_PATH: Record<GuidedTourStopKey, string> = {
  learn: "learn",
  practice: "practice",
  answers: "answers",
  revision: "revision",
  doubts: "doubts",
  current_affairs: "current-affairs",
  scoreboard: "scoreboard",
  community: "community",
  explore: "explore",
};

export function guidedTourStopPath(stop: GuidedTourStopKey, locale: Locale): string {
  return `/${locale}/${STOP_PATH[stop]}`;
}

export const GUIDED_TOUR_TOTAL = GUIDED_TOUR_STOPS.length;
