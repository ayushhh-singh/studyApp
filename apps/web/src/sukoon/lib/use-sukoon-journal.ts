/**
 * Sukoon F4 journal data hooks — TanStack Query over the /api/sukoon/journal
 * endpoints, plus a small SSE hook for the streamed AI reflection (mirrors
 * use-sukoon-chat's streaming pattern). Bodies only ever arrive on the single
 * -entry / export fetches; lists are metadata only.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  sukoonJournalListResponseSchema,
  sukoonJournalEntryResponseSchema,
  sukoonJournalPromptsResponseSchema,
  sukoonJournalHeatmapResponseSchema,
  sukoonReflectionUsageResponseSchema,
  sukoonJournalExportResponseSchema,
  apiEnvelopeSchema,
  sukoonJournalStreakSchema,
  type SukoonJournalCreateBody,
  type SukoonJournalEntry,
  type SukoonJournalUpdateBody,
  type SukoonReflectionUsage,
} from "@neev/shared";
import { z } from "zod";
import { api } from "@/lib/api";
import { streamEvents } from "@/lib/sse";
import { queryKeys } from "@/lib/query-keys";
import type { QueueStatus } from "@/lib/offline-queue";
import { createSukoonWriteQueue } from "@/sukoon/lib/sukoon-write-queue";

const API_URL = import.meta.env.VITE_API_URL as string;
const streakEnvelopeSchema = apiEnvelopeSchema(z.object({ streak: sukoonJournalStreakSchema }));

export interface JournalFilters {
  tag?: string;
  mood?: number;
  category?: string;
  from?: string;
  to?: string;
  page?: number;
}

export function useJournalList(filters: JournalFilters, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonJournalList(filters),
    queryFn: () =>
      api.get("/api/sukoon/journal", sukoonJournalListResponseSchema, {
        ...(filters.tag ? { tag: filters.tag } : {}),
        ...(filters.mood != null ? { mood: filters.mood } : {}),
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        page: filters.page ?? 1,
      }),
    enabled: options?.enabled ?? true,
  });
}

export function useJournalEntry(id: string | undefined, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonJournalEntry(id ?? ""),
    queryFn: () =>
      api.get(`/api/sukoon/journal/entries/${id}`, sukoonJournalEntryResponseSchema),
    enabled: (options?.enabled ?? true) && !!id,
  });
}

export function useJournalPrompts(
  filters: { category?: string; exam_phase?: string },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.sukoonJournalPrompts(filters),
    queryFn: () =>
      api.get("/api/sukoon/journal/prompts", sukoonJournalPromptsResponseSchema, {
        ...(filters.category ? { category: filters.category } : {}),
        ...(filters.exam_phase ? { exam_phase: filters.exam_phase } : {}),
      }),
    enabled: options?.enabled ?? true,
  });
}

export function useJournalHeatmap(month: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonJournalHeatmap(month),
    queryFn: () =>
      api.get("/api/sukoon/journal/heatmap", sukoonJournalHeatmapResponseSchema, { month }),
    enabled: options?.enabled ?? true,
  });
}

export function useJournalStreak(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonJournalStreak(),
    queryFn: () => api.get("/api/sukoon/journal/streak", streakEnvelopeSchema),
    enabled: options?.enabled ?? true,
  });
}

export function useReflectionUsage(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.sukoonReflectionUsage(),
    queryFn: () =>
      api.get("/api/sukoon/journal/reflection/usage", sukoonReflectionUsageResponseSchema),
    enabled: options?.enabled ?? true,
  });
}

/** Invalidate everything that a create/update/delete can change (list, streak, heatmap). */
function useInvalidateJournal() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["sukoon", "journal"] });
  }, [queryClient]);
}

/**
 * One item in the journal write queue — either a brand-new entry (no id yet;
 * `queueKey` is a client-only uuid the caller keeps stable across repeated
 * Save clicks on the SAME unsynced draft, see journal-editor.tsx) or an edit
 * of an existing entry (`queueKey` is the entry's real id, so a re-save
 * before the previous one has synced just replaces the queued snapshot —
 * the offline queue's own last-write-wins dedupe, no duplicate PATCHes).
 */
export interface JournalWriteItem {
  queueKey: string;
  op: "create" | "update";
  entryId?: string;
  body: SukoonJournalCreateBody | SukoonJournalUpdateBody;
}

function journalResolvedKey(queueKey: string) {
  return ["sukoon", "journal", "pending-resolved", queueKey] as const;
}

/**
 * Journal entry create/update, routed through the SAME localStorage-backed
 * offline queue the MCQ test player's autosave uses (@/lib/offline-queue) —
 * a save made with no connection queues locally instead of failing, and
 * flushes automatically once the connection returns. Wrapped in
 * createSukoonWriteQueue (not the plain queue) because a batch here can mix
 * a "create" (POST, not naturally idempotent) with an "update" (PATCH, safe
 * to resend) for different entries — see that module's header for why a
 * plain all-or-nothing retry would risk a duplicate entry.
 *
 * A create's real server id isn't known until it syncs, so `sendOne` stashes
 * the created entry into the query cache under a `queueKey`-scoped key —
 * `getResolvedCreate` lets the editor pick it up (to navigate to the new
 * entry) once it appears, whether that's near-instant (online) or after a
 * real reconnect.
 */
export function useJournalWriteQueue(): {
  save: (input: JournalWriteItem) => void;
  status: QueueStatus;
  getResolvedCreate: (queueKey: string) => SukoonJournalEntry | undefined;
} {
  const queryClient = useQueryClient();

  const queue = useMemo(
    () =>
      createSukoonWriteQueue<JournalWriteItem>({
        storageKey: "sukoon-journal-write-queue",
        dedupeKey: (item) => item.queueKey,
        sendOne: async (item) => {
          if (item.op === "update") {
            await api.patch(
              `/api/sukoon/journal/entries/${item.entryId}`,
              sukoonJournalEntryResponseSchema,
              item.body,
            );
          } else {
            const res = await api.post(
              "/api/sukoon/journal/entries",
              sukoonJournalEntryResponseSchema,
              item.body,
            );
            queryClient.setQueryData(journalResolvedKey(item.queueKey), res.entry);
          }
          void queryClient.invalidateQueries({ queryKey: ["sukoon", "journal"] });
          // A new entry is one of the three activities that grow the Garden
          // (F11) — refresh it so Home reflects it right away. An edit
          // doesn't add a new day-count row, so this is harmless-but-unneeded
          // for updates too; invalidating either way keeps this one path simple.
          void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonGarden() });
        },
      }),
    [queryClient],
  );

  const status = useSyncExternalStore(
    (listener) => queue.subscribe(listener),
    () => queue.getStatus(),
  );

  useEffect(() => {
    // Flush on mount too, not just unmount — this queue is localStorage-durable
    // and outlives a single page visit, so an entry stranded by a closed tab
    // or a connection drop shouldn't sit unsent until the next unrelated save
    // (mirrors use-srs-review-queue.ts's identical reasoning).
    queue.flushNow().catch(() => {});
    return () => {
      queue.flushNow().catch(() => {});
    };
  }, [queue]);

  return {
    save: (input) => queue.enqueue(input),
    status,
    getResolvedCreate: (queueKey) => queryClient.getQueryData(journalResolvedKey(queueKey)),
  };
}

export function useDeleteJournalEntry() {
  const invalidate = useInvalidateJournal();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/sukoon/journal/entries/${id}`),
    onSuccess: () => invalidate(),
  });
}

export function fetchExportRange(from: string, to: string) {
  return api.get("/api/sukoon/journal/export", sukoonJournalExportResponseSchema, { from, to });
}

/**
 * The streamed AI reflection for one entry. `run(entryId)` opens the SSE stream;
 * `text` accumulates the deltas; `status` drives the UI. On success the entry +
 * reflection-usage caches are invalidated so the persisted reflection + the new
 * "N left" show without a manual refetch.
 */
type ReflectStatus = "idle" | "streaming" | "done" | "error";
export function useReflectionStream() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<ReflectStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<SukoonReflectionUsage | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setText("");
    setStatus("idle");
    setError(null);
    setUsage(null);
  }, []);

  const run = useCallback(
    (entryId: string) => {
      controllerRef.current?.abort();
      setText("");
      setError(null);
      setUsage(null);
      setStatus("streaming");
      const acc = { text: "" };
      controllerRef.current = streamEvents({
        url: `${API_URL}/api/sukoon/journal/entries/${entryId}/reflect`,
        method: "POST",
        onEvent: (event, data) => {
          if (event === "delta") {
            acc.text += (data as { text: string }).text;
            setText(acc.text);
          } else if (event === "reflection_saved") {
            setUsage((data as { usage: SukoonReflectionUsage }).usage);
          } else if (event === "done") {
            setStatus("done");
            void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonJournalEntry(entryId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.sukoonReflectionUsage() });
            void queryClient.invalidateQueries({ queryKey: ["sukoon", "journal", "list"] });
          } else if (event === "error") {
            setError((data as { message: string }).message);
            setStatus("error");
          }
        },
        onError: (err) => {
          setError(err instanceof Error ? err.message : "Something went wrong");
          setStatus("error");
        },
      });
    },
    [queryClient],
  );

  return { text, status, error, usage, run, reset };
}
