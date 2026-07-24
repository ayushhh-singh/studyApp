/**
 * Drives ONE ambient-mixer channel (rain/tanpura/crickets/fan): plays the real
 * uploaded loop from the sukoon-audio bucket when one exists, falling back to
 * a synthesized placeholder (sukoon-audio-synth.ts) on a 404/load error or
 * when no file has been uploaded yet — so the mixer is fully functional today
 * and silently upgrades the moment a real file lands, no code change needed.
 * The real-file path uses the plain <audio> element's own `.volume` (not a
 * Web Audio graph) to sidestep any CORS/MediaElementSource fragility; only the
 * synthesized fallback needs raw Web Audio since there's no file to play.
 */
import { useEffect, useRef } from "react";
import type { SukoonAmbientId } from "@neev/shared";
import { useAmbientAudioUrl } from "./use-sukoon-exercises";
import { getAudioContext, startSynthesizedAmbient, type AmbientVoice } from "./sukoon-audio-synth";

export function useAmbientChannel(id: SukoonAmbientId, playing: boolean, volume: number): void {
  const urlQuery = useAmbientAudioUrl(id, { enabled: playing });
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const voiceRef = useRef<AmbientVoice | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    if (!playing) return;
    let cancelled = false;

    const startFallback = () => {
      if (cancelled || voiceRef.current) return;
      voiceRef.current = startSynthesizedAmbient(id, getAudioContext().destination, volumeRef.current);
    };

    if (urlQuery.data?.url) {
      const el = new Audio(urlQuery.data.url);
      el.loop = true;
      el.volume = volumeRef.current;
      el.addEventListener("error", startFallback, { once: true });
      void el.play().catch(startFallback);
      audioElRef.current = el;
    } else if (urlQuery.isError) {
      startFallback();
    }

    return () => {
      cancelled = true;
      const el = audioElRef.current;
      if (el) {
        el.pause();
        el.removeAttribute("src");
        audioElRef.current = null;
      }
      voiceRef.current?.stop();
      voiceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, urlQuery.data?.url, urlQuery.isError, id]);

  useEffect(() => {
    if (audioElRef.current) audioElRef.current.volume = volume;
    voiceRef.current?.setVolume(volume);
  }, [volume]);
}
