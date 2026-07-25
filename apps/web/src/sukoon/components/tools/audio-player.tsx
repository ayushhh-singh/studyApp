/**
 * A custom audio player (blueprint F6: "custom audio player, play/pause/seek/
 * 15s skip") wired to the Media Session API so playback survives backgrounding
 * and shows real lock-screen/notification controls — used by both the guided
 * meditation player and PMR-with-audio.
 */
import { useEffect, useRef, useState } from "react";
import { Play, Pause, RotateCcw, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

const SKIP_SECONDS = 15;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function AudioPlayer({
  src,
  title,
  onPlay,
  onEnded,
  onPlayingChange,
}: {
  src: string;
  title: string;
  /** Fires on every native `play` event (resume included) — dedupe in the caller if only the first matters. */
  onPlay?: () => void;
  onEnded?: () => void;
  /** Fires whenever playback starts/stops (play/pause/ended) — used by the
   *  personalized-meditation player to fade its ambient bed in and out with the
   *  narration. Additive; existing callers ignore it. */
  onPlayingChange?: (playing: boolean) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  // Media Session — lock-screen/notification transport controls + metadata.
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist: "Sukoon" });
    const audio = audioRef.current;
    navigator.mediaSession.setActionHandler("play", () => audio?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio?.pause());
    navigator.mediaSession.setActionHandler("seekbackward", () => {
      if (audio) audio.currentTime = Math.max(0, audio.currentTime - SKIP_SECONDS);
    });
    navigator.mediaSession.setActionHandler("seekforward", () => {
      if (audio) audio.currentTime = Math.min(audio.duration || Infinity, audio.currentTime + SKIP_SECONDS);
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
    };
  }, [title]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }, [playing]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play();
    else audio.pause();
  };

  const skip = (delta: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + delta), audio.duration || Infinity);
  };

  return (
    <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-card p-6">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          onPlay?.();
          onPlayingChange?.(true);
        }}
        onPause={() => {
          setPlaying(false);
          onPlayingChange?.(false);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => {
          setPlaying(false);
          onPlayingChange?.(false);
          onEnded?.();
        }}
      />
      <div className="flex w-full flex-col gap-1.5">
        <Slider
          value={[current]}
          max={duration || 0}
          step={1}
          onValueChange={([v]) => {
            if (audioRef.current && v != null) audioRef.current.currentTime = v;
          }}
        />
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{formatTime(current)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="flex items-center gap-5">
        <Button type="button" variant="ghost" size="icon" aria-label={`Back ${SKIP_SECONDS}s`} onClick={() => skip(-SKIP_SECONDS)}>
          <RotateCcw className="size-5" />
        </Button>
        <Button
          type="button"
          size="icon"
          className="size-14 rounded-full"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause className="size-6" /> : <Play className="size-6" />}
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={`Forward ${SKIP_SECONDS}s`} onClick={() => skip(SKIP_SECONDS)}>
          <RotateCw className="size-5" />
        </Button>
      </div>
    </div>
  );
}
