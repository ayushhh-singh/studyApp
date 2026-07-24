/**
 * Sukoon F4 journal data hooks — TanStack Query over the /api/sukoon/journal
 * endpoints, plus a small SSE hook for the streamed AI reflection (mirrors
 * use-sukoon-chat's streaming pattern). Bodies only ever arrive on the single
 * -entry / export fetches; lists are metadata only.
 */
import { useCallback, useRef, useState } from "react";
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
  type SukoonJournalUpdateBody,
  type SukoonReflectionUsage,
} from "@neev/shared";
import { z } from "zod";
import { api } from "@/lib/api";
import { streamEvents } from "@/lib/sse";
import { queryKeys } from "@/lib/query-keys";

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

export function useCreateJournalEntry() {
  const invalidate = useInvalidateJournal();
  return useMutation({
    mutationFn: (body: SukoonJournalCreateBody) =>
      api.post("/api/sukoon/journal/entries", sukoonJournalEntryResponseSchema, body),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateJournalEntry(id: string) {
  const invalidate = useInvalidateJournal();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SukoonJournalUpdateBody) =>
      api.patch(`/api/sukoon/journal/entries/${id}`, sukoonJournalEntryResponseSchema, body),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.sukoonJournalEntry(id), data);
      invalidate();
    },
  });
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
