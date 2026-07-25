/**
 * Sukoon F5 mood-tracking data hooks — TanStack Query over the
 * /api/sukoon/mood endpoints. Mirrors use-sukoon-journal.ts's conventions.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonMoodTodayResponseSchema,
  sukoonMoodAggregatesResponseSchema,
  sukoonMoodHeatmapResponseSchema,
  sukoonMoodEntryResponseSchema,
  sukoonMoodPatternResponseSchema,
  type SukoonMoodCreateBody,
  type SukoonMoodEntry,
  type SukoonMoodUpdateBody,
} from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type { QueueStatus } from "@/lib/offline-queue";
import { createSukoonWriteQueue } from "@/sukoon/lib/sukoon-write-queue";

export function useMoodToday(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMoodToday(),
    queryFn: () => api.get("/api/sukoon/mood/today", sukoonMoodTodayResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useMoodAggregates(rangeDays: 7 | 30 | 90, options?: { enabled?: boolean }) {
  const range = String(rangeDays);
  return useQuery({
    queryKey: queryKeys.sukoonMoodAggregates(range),
    queryFn: () =>
      api.get("/api/sukoon/mood/aggregates", sukoonMoodAggregatesResponseSchema, { range }),
    enabled: options?.enabled ?? true,
  });
}

/**
 * The proactive mood-pattern bridge (F5×F6) — a conservative decline read that
 * powers the gentle nudge card. `.data.tier` is "none" unless a genuine trend
 * is found. Cached a little longer than the per-second surfaces since it's a
 * cross-day trend, not live state, and invalidated by a new check-in (the mood
 * mutations already invalidate the whole ["sukoon","mood"] family).
 */
export function useMoodPattern(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMoodPattern(),
    queryFn: () => api.get("/api/sukoon/mood/pattern", sukoonMoodPatternResponseSchema),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

export function useMoodHeatmap(month: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonMoodHeatmap(month),
    queryFn: () => api.get("/api/sukoon/mood/heatmap", sukoonMoodHeatmapResponseSchema, { month }),
    enabled: options?.enabled ?? true,
  });
}

/** Invalidate everything a create/update/delete can change (today, aggregates,
 *  heatmap) — plus the Garden (F11), since a check-in is one of the three
 *  activities that grow it, so the Home card should reflect it right away
 *  rather than waiting for an unrelated refocus/remount to refetch it. */
function useInvalidateMood() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sukoon", "mood"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonGarden() });
  }, [queryClient]);
}

/**
 * One item in the mood write queue — either a brand-new check-in (no id yet;
 * `queueKey` is a client-only uuid the caller keeps stable across repeated
 * Save clicks on the SAME unsynced check-in, see mood.tsx) or an edit of an
 * already-saved entry (`queueKey` is the entry's real id, so a re-save before
 * the previous one has synced just replaces the queued snapshot — the
 * offline queue's own last-write-wins dedupe, no duplicate PATCHes).
 */
export interface MoodWriteItem {
  queueKey: string;
  op: "create" | "update";
  entryId?: string;
  body: SukoonMoodCreateBody | SukoonMoodUpdateBody;
}

function moodResolvedKey(queueKey: string) {
  return ["sukoon", "mood", "pending-resolved", queueKey] as const;
}

/**
 * Mood check-in create/update, routed through the SAME localStorage-backed
 * offline queue the MCQ test player's autosave uses (@/lib/offline-queue) —
 * a check-in made with no connection queues locally instead of failing, and
 * flushes automatically once the connection returns. See
 * use-sukoon-journal.ts's identical useJournalWriteQueue (and
 * sukoon-write-queue.ts's header) for why this goes through
 * createSukoonWriteQueue rather than the plain queue: a batch here can mix a
 * "create" (POST) with an "update" (PATCH) for different entries, and a
 * plain all-or-nothing retry would risk resending an already-synced create.
 */
export function useMoodWriteQueue(): {
  save: (input: MoodWriteItem) => void;
  status: QueueStatus;
  getResolvedCreate: (queueKey: string) => SukoonMoodEntry | undefined;
} {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateMood();

  const queue = useMemo(
    () =>
      createSukoonWriteQueue<MoodWriteItem>({
        storageKey: "sukoon-mood-write-queue",
        dedupeKey: (item) => item.queueKey,
        sendOne: async (item) => {
          if (item.op === "update") {
            await api.patch(
              `/api/sukoon/mood/entries/${item.entryId}`,
              sukoonMoodEntryResponseSchema,
              item.body,
            );
          } else {
            const res = await api.post(
              "/api/sukoon/mood/entries",
              sukoonMoodEntryResponseSchema,
              item.body,
            );
            queryClient.setQueryData(moodResolvedKey(item.queueKey), res.entry);
          }
          invalidate();
        },
      }),
    [queryClient, invalidate],
  );

  const status = useSyncExternalStore(
    (listener) => queue.subscribe(listener),
    () => queue.getStatus(),
  );

  useEffect(() => {
    // Flush on mount too, not just unmount — this queue is localStorage-durable
    // and outlives a single page visit (mirrors use-srs-review-queue.ts).
    queue.flushNow().catch(() => {});
    return () => {
      queue.flushNow().catch(() => {});
    };
  }, [queue]);

  return {
    save: (input) => queue.enqueue(input),
    status,
    getResolvedCreate: (queueKey) => queryClient.getQueryData(moodResolvedKey(queueKey)),
  };
}

export function useDeleteMoodEntry() {
  const invalidate = useInvalidateMood();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/sukoon/mood/entries/${id}`),
    onSuccess: () => invalidate(),
  });
}
