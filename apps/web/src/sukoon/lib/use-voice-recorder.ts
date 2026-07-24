/**
 * F10 Voice Mode's microphone capture: permission handling, MediaRecorder
 * lifecycle, a live 0-1 volume level (for the waveform), and a hard 60s
 * auto-stop (SUKOON_VOICE_MAX_TURN_SECONDS) so a forgotten hold never records
 * past what the server will accept. Supports BOTH interaction models the
 * blueprint asks for: hold-to-talk (`start`/`stop` called directly from
 * pointerdown/pointerup) and tap-to-toggle (a caller can call `start` then
 * later `stop` from two separate taps) — this hook doesn't care which.
 *
 * Container/codec choice is picked once, in priority order, from whatever
 * THIS browser's MediaRecorder actually supports (Chrome/Firefox/Edge default
 * to webm/opus, Safari to mp4/aac) — the resulting base mime type (no codec
 * suffix) is exactly one of SUKOON_VOICE_AUDIO_MIME_TYPES, so the server
 * never has to guess or transcode.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { SUKOON_VOICE_MAX_TURN_SECONDS, type SukoonVoiceAudioMime } from "@neev/shared";

export type RecorderPermission = "unknown" | "granted" | "denied" | "unsupported";
export type RecorderState = "idle" | "recording" | "processing";

export interface VoiceRecordingResult {
  blob: Blob;
  mimeType: SukoonVoiceAudioMime;
  durationSeconds: number;
}

const CANDIDATE_MIME_TYPES: { recorderType: string; base: SukoonVoiceAudioMime }[] = [
  { recorderType: "audio/webm;codecs=opus", base: "audio/webm" },
  { recorderType: "audio/webm", base: "audio/webm" },
  { recorderType: "audio/ogg;codecs=opus", base: "audio/ogg" },
  { recorderType: "audio/mp4", base: "audio/mp4" },
  { recorderType: "audio/mpeg", base: "audio/mpeg" },
];

function pickMimeType(): { recorderType: string | undefined; base: SukoonVoiceAudioMime } {
  if (typeof MediaRecorder === "undefined") return { recorderType: undefined, base: "audio/webm" };
  for (const candidate of CANDIDATE_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate.recorderType)) return candidate;
  }
  // No explicit type supported — let the browser pick its own default.
  return { recorderType: undefined, base: "audio/webm" };
}

export function useVoiceRecorder(onComplete: (result: VoiceRecordingResult) => void) {
  const [permission, setPermission] = useState<RecorderPermission>("unknown");
  const [state, setState] = useState<RecorderState>("idle");
  const [level, setLevel] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const baseMimeRef = useRef<SukoonVoiceAudioMime>("audio/webm");
  // Bumped by cancel()/unmount so an in-flight start() can tell it's been
  // superseded once its getUserMedia() await resolves — see the race this
  // guards against in start()'s own comment below.
  const generationRef = useRef(0);

  const stopLevelLoop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setLevel(0);
  }, []);

  const teardownStream = useCallback(() => {
    stopLevelLoop();
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = null;
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      void audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
  }, [stopLevelLoop]);

  const runLevelLoop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      // RMS of the waveform, centered on 128 (silence) — a simple, cheap
      // proxy for "how loud right now", good enough for a visual waveform.
      let sumSq = 0;
      for (let i = 0; i < data.length; i++) {
        const centered = (data[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / data.length);
      setLevel(Math.min(1, rms * 4)); // scaled up — raw RMS for speech is quiet
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setState("processing");
    recorder.stop();
  }, []);

  const start = useCallback(async () => {
    if (state !== "idle") return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setPermission("unsupported");
      return;
    }

    // getUserMedia() can hang for as long as the OS/browser permission prompt
    // stays open (real seconds, not milliseconds) — if cancel() or an unmount
    // fires while it's pending, this closure resolves LATER against a
    // generation nothing is listening to anymore. Without this guard the
    // continuation below would still wire up a live mic stream/MediaRecorder/
    // AudioContext with no component left alive to ever call cancel() again —
    // a real dangling-microphone leak, not just a stale-state no-op.
    const myGeneration = ++generationRef.current;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (generationRef.current !== myGeneration) return;
      const name = err instanceof DOMException ? err.name : "";
      setPermission(name === "NotFoundError" || name === "NotSupportedError" ? "unsupported" : "denied");
      return;
    }
    if (generationRef.current !== myGeneration) {
      // Superseded while awaiting permission — release the stream immediately
      // and do nothing else (no refs to set, no recorder to build).
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    setPermission("granted");
    streamRef.current = stream;

    // Live volume level via a small Web Audio analyser — purely visual, never
    // sent anywhere.
    try {
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        runLevelLoop();
      }
    } catch {
      // Waveform is cosmetic — a failure here must never block recording.
    }

    const { recorderType, base } = pickMimeType();
    baseMimeRef.current = base;
    const recorder = recorderType
      ? new MediaRecorder(stream, { mimeType: recorderType })
      : new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const durationSeconds = Math.min(
        SUKOON_VOICE_MAX_TURN_SECONDS,
        Math.max(0, (Date.now() - startedAtRef.current) / 1000),
      );
      const blob = new Blob(chunksRef.current, { type: baseMimeRef.current });
      teardownStream();
      setState("idle");
      setElapsedSeconds(0);
      if (blob.size > 0 && durationSeconds > 0.2) {
        onCompleteRef.current({ blob, mimeType: baseMimeRef.current, durationSeconds });
      }
    };
    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    recorder.start();
    setState("recording");
    setElapsedSeconds(0);
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.min(SUKOON_VOICE_MAX_TURN_SECONDS, (Date.now() - startedAtRef.current) / 1000));
    }, 200);
    autoStopRef.current = setTimeout(stop, SUKOON_VOICE_MAX_TURN_SECONDS * 1000);
  }, [state, runLevelLoop, teardownStream, stop]);

  /** Abandon a recording in progress without delivering it (e.g. the user
   *  navigates away mid-hold, or a crisis takeover interrupts). Also
   *  invalidates any start() still awaiting getUserMedia() permission — see
   *  the comment in start() for why that matters. */
  const cancel = useCallback(() => {
    generationRef.current++;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    teardownStream();
    setState("idle");
    setElapsedSeconds(0);
  }, [teardownStream]);

  useEffect(() => () => cancel(), [cancel]);

  return { permission, state, level, elapsedSeconds, start, stop, cancel };
}
