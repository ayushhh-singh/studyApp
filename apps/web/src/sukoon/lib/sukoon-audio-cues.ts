/**
 * Plays Sukoon's tiny BUNDLED cue set — the singing-bowl start/end chime and
 * the breathing-phase cues — from static assets under public/sukoon/audio, with
 * the same real-file-with-synth-fallback contract the ambient mixer uses: a
 * genuine recorded/rendered MP3 is preferred, and a Web-Audio synth stands in
 * only if that file can't load/play (offline before precache, decode error).
 *
 * These cues MUST fire instantly on tap (a start chime, a per-breath cue), so
 * they are bundled + SW-precached rather than fetched from the signed-URL
 * bucket the way the large ambient/meditation files are — a per-play network
 * round-trip would make the chime lag the gesture. Each cue reuses ONE lazily
 * created <audio> element, unlocked by the first gesture-driven play, so later
 * programmatic replays (e.g. the timer's end chime) aren't autoplay-blocked.
 */
import { playSingingBowlChime, playSynthBreathCue } from "./sukoon-audio-synth";

const STATIC_BASE = "/sukoon/audio";
const elements = new Map<string, HTMLAudioElement>();

function cueEl(file: string): HTMLAudioElement {
  let el = elements.get(file);
  if (!el) {
    el = new Audio(`${STATIC_BASE}/${file}`);
    el.preload = "auto";
    elements.set(file, el);
  }
  return el;
}

function playFile(file: string, volume: number, onFail: () => void): void {
  const el = cueEl(file);
  el.volume = Math.min(1, Math.max(0, volume));
  try {
    el.currentTime = 0;
  } catch {
    /* not yet seekable — play from wherever it is */
  }
  void el.play().catch(onFail);
}

/** Singing-bowl chime for meditation-timer start/end. Prefers the real file,
 *  synthesises a bowl tone if it can't play. */
export function playChime(volume = 0.7): void {
  playFile("singing-bowl.mp3", volume, () => playSingingBowlChime(undefined, volume));
}

export type BreathCueKind = "inhale" | "exhale" | "hold";

const CUE_FILES: Record<BreathCueKind, string> = {
  inhale: "breath-inhale.mp3",
  exhale: "breath-exhale.mp3",
  hold: "breath-hold.mp3",
};

/** A soft paced cue for one breathing phase. Prefers the real file, falls back
 *  to a synthesised swell/tap. */
export function playBreathCue(kind: BreathCueKind, volume = 0.5): void {
  playFile(CUE_FILES[kind], volume, () => playSynthBreathCue(kind, volume));
}
