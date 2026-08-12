import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { SEARCH_MIN_QUERY_LENGTH, searchResponseSchema } from "@neev/shared";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { useLocale } from "@/hooks/use-locale";

/**
 * How long typing must pause before a query is sent.
 *
 * This is now a real network round-trip per pause, not a client-side filter, so
 * the number is a genuine trade: too low and a burst of typing fires a request
 * per character (and walks into the 120/min limiter); too high and the box
 * feels dead. 250ms sits just under the ~300ms at which a pause starts to read
 * as lag, and slightly tighter than the 300ms the revision card list uses for
 * what is a secondary filter rather than the primary interaction.
 */
const DEBOUNCE_MS = 250;

/** Trailing-edge debounce. The final value always lands — the timer is reset, not dropped. */
export function useDebouncedValue<T>(value: T, delayMs = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Central search across syllabus topics, chapters, PYQs, personal notes and
 * current affairs — all exam-scoped server-side.
 *
 * `keepPreviousData` is what makes this feel like a filter rather than a
 * sequence of page loads: the previous query's results stay on screen while the
 * next one is in flight, so refining a query never blanks the list. `isFetching`
 * (not `isLoading`) is therefore the right "working" signal for the caller —
 * `isLoading` is only true on the very first query of a session.
 */
export function useSearch(rawQuery: string) {
  const locale = useLocale();
  const query = useDebouncedValue(rawQuery.trim());
  const enabled = query.length >= SEARCH_MIN_QUERY_LENGTH;

  const result = useQuery({
    queryKey: queryKeys.search(query, locale),
    queryFn: () => api.get("/api/v1/search", searchResponseSchema, { q: query, locale }),
    enabled,
    placeholderData: keepPreviousData,
    // Content changes on an ingest cadence, not per session; within one palette
    // session a repeated query should never re-hit the network.
    staleTime: 60_000,
    // A search box must not spend the user's rate-limit budget retrying — a
    // failure is cheap to recover from by typing one more character.
    retry: false,
  });

  return {
    ...result,
    /** The query the visible results actually correspond to (debounced, not raw). */
    query,
    /** False while the user is still below the minimum length — not an error, not empty. */
    enabled,
    /** True whenever the user has typed something the debounce has not caught up with. */
    isTyping: rawQuery.trim() !== query,
  };
}
