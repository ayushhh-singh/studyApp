import { Wind, Compass, Waves, Timer as TimerIcon, Moon, type LucideIcon } from "lucide-react";
import type { SukoonExerciseType } from "@neev/shared";

export const SUKOON_TOOL_ICONS: Record<SukoonExerciseType, LucideIcon> = {
  breathing: Wind,
  grounding: Compass,
  pmr: Waves,
  timer: TimerIcon,
  meditation: Moon,
};

/** The player route each exercise type opens into (see routes.tsx). */
export function toolPlayerPath(type: SukoonExerciseType, id: string): string {
  return `tools/${type}/${id}`;
}
