import { useMutation } from "@tanstack/react-query";
import { sukoonCrisisAssessResponseSchema, type SukoonCrisisAssessment } from "@neev/shared";
import { api } from "@/lib/api";

/**
 * Dev-only: run the live crisis engine on a typed message. Powers the hidden
 * /sukoon/dev/crisis page. The endpoint (mounted only when the API's devTools
 * flag is on) requires auth and, because it calls the real engine, logs a
 * crisis event + counts toward the rate limiter — so this is a genuine probe of
 * the full path, not a mock.
 */
export function useCrisisAssess() {
  return useMutation<SukoonCrisisAssessment, Error, string>({
    mutationFn: (text: string) =>
      api.post("/api/sukoon/dev/crisis/assess", sukoonCrisisAssessResponseSchema, { text }),
  });
}
