/**
 * Resolves a playable `src` for one exercise's audio: a pinned offline copy
 * first (sukoon-audio-cache.ts), else a freshly-minted signed URL (only
 * attempted while online — a signed-URL fetch would just fail offline anyway).
 */
import { useEffect, useState } from "react";
import type { SukoonExerciseAudioLang } from "@neev/shared";
import { useExerciseAudioUrl } from "./use-sukoon-exercises";
import { useSukoonOnline } from "./use-sukoon-online";
import { getPinnedAudioObjectUrl, pinKey } from "./sukoon-audio-cache";

export type ResolvedAudioSrc =
  | { status: "idle" | "checking-pin" | "loading" }
  | { status: "offline-unavailable" | "error" }
  | { status: "ready"; src: string; signedUrl: string | null };

export function useResolvedAudioSrc(
  exerciseId: string,
  lang: SukoonExerciseAudioLang,
  enabled: boolean,
): ResolvedAudioSrc {
  const online = useSukoonOnline();
  const [pinnedUrl, setPinnedUrl] = useState<string | null | undefined>(undefined); // undefined = still checking
  const key = pinKey(exerciseId, lang);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setPinnedUrl(undefined);
    getPinnedAudioObjectUrl(key)
      .then((url) => {
        if (cancelled) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        createdUrl = url;
        setPinnedUrl(url);
      })
      .catch(() => {
        if (!cancelled) setPinnedUrl(null);
      });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [key, enabled]);

  const needsSigned = enabled && pinnedUrl === null;
  const signedQuery = useExerciseAudioUrl(exerciseId, lang, { enabled: needsSigned && online });

  if (!enabled) return { status: "idle" };
  if (pinnedUrl === undefined) return { status: "checking-pin" };
  if (pinnedUrl) return { status: "ready", src: pinnedUrl, signedUrl: null };
  if (!online) return { status: "offline-unavailable" };
  if (signedQuery.isError) return { status: "error" };
  if (signedQuery.data?.url) return { status: "ready", src: signedQuery.data.url, signedUrl: signedQuery.data.url };
  return { status: "loading" };
}
