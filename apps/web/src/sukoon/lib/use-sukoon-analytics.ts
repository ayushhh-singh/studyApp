import { useCallback, useEffect, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  sukoonAnalyticsEventResponseSchema,
  type SukoonAnalyticsEventBody,
  type SukoonAnalyticsEventName,
} from "@neev/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/providers/auth-provider";

/**
 * Session 14 — the client's half of privacy-aware analytics. Fire-and-forget:
 * a dropped ping must never surface an error to the user, so this deliberately
 * never exposes the mutation's error/pending state to callers.
 */
export function useRecordSukoonEvent() {
  const mutation = useMutation({
    mutationFn: (body: SukoonAnalyticsEventBody) =>
      api.post("/api/sukoon/analytics/events", sukoonAnalyticsEventResponseSchema, body),
  });
  return useCallback(
    (name: SukoonAnalyticsEventName, props: SukoonAnalyticsEventBody["props"] = {}) => {
      mutation.mutate({ name, props });
    },
    // mutation.mutate is a stable reference from useMutation — safe to omit `mutation` itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
}

/**
 * Fires ONE `feature_viewed` ping the first time this hook mounts on a real
 * signed-in session — the DAU/feature-usage signal (blueprint Session 14).
 * Never re-fires on a re-render or a prop change, only a genuine remount.
 */
export function useTrackSukoonFeatureView(feature: string): void {
  const { session } = useAuth();
  const record = useRecordSukoonEvent();
  const firedRef = useRef(false);

  useEffect(() => {
    if (!session || firedRef.current) return;
    firedRef.current = true;
    record("feature_viewed", { feature });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, feature]);
}
