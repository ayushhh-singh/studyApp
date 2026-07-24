/**
 * Web Audio API synthesis for two F6 needs that have no pre-rendered file yet:
 * (1) the singing-bowl start/end chime for the unguided timer, and (2) the
 * four ambient-mixer beds (rain/tanpura/crickets/fan) as a PLACEHOLDER —
 * `use-ambient-voice.ts` prefers a real uploaded loop from the sukoon-audio
 * bucket the moment one exists (see that file), so this synthesis is only
 * ever the fallback, not a permanent parallel implementation.
 *
 * One shared AudioContext, lazily created on first user gesture (autoplay
 * policies require this — never construct one at module load).
 */
import type { SukoonAmbientId } from "@neev/shared";

let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** A bell-like tone: a few inharmonic sine partials with a long exponential
 *  decay, the standard cheap-synthesis approach for a singing-bowl/gong sound. */
export function playSingingBowlChime(destination?: AudioNode, volume = 0.5): void {
  const audioCtx = getAudioContext();
  const out = destination ?? audioCtx.destination;
  const now = audioCtx.currentTime;
  const partials = [1, 2.76, 5.4, 8.93]; // inharmonic ratios approximate a struck-bowl spectrum
  const fundamental = 220;
  const master = audioCtx.createGain();
  master.gain.value = volume;
  master.connect(out);

  for (const [i, ratio] of partials.entries()) {
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = fundamental * ratio;
    const gain = audioCtx.createGain();
    const peak = volume * (1 / (i + 1));
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.5 - i * 0.4);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 6);
  }
}

export interface AmbientVoice {
  setVolume(v: number): void;
  stop(): void;
}

function whiteNoiseBuffer(audioCtx: AudioContext, seconds = 3): AudioBuffer {
  const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * seconds, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function filteredNoiseVoice(
  audioCtx: AudioContext,
  destination: AudioNode,
  filterType: BiquadFilterType,
  frequency: number,
  q: number,
  initialVolume: number,
): AmbientVoice {
  const source = audioCtx.createBufferSource();
  source.buffer = whiteNoiseBuffer(audioCtx);
  source.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = audioCtx.createGain();
  gain.gain.value = initialVolume;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start();
  return {
    setVolume: (v) => gain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.05),
    stop: () => {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    },
  };
}

/** A slow drone (2 detuned low oscillators) approximating a tanpura's resonant hum. */
function tanpuraVoice(audioCtx: AudioContext, destination: AudioNode, initialVolume: number): AmbientVoice {
  const gain = audioCtx.createGain();
  gain.gain.value = initialVolume;
  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  filter.connect(gain);
  gain.connect(destination);

  const oscillators: OscillatorNode[] = [];
  const ratios = [1, 1.5, 2]; // root, fifth, octave — the tanpura's characteristic drone
  for (const ratio of ratios) {
    const osc = audioCtx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55 * ratio;
    const voiceGain = audioCtx.createGain();
    voiceGain.gain.value = 0.25;
    // A slow tremolo approximates the resonant "buzz" of a plucked string decaying and re-plucking.
    const lfo = audioCtx.createOscillator();
    lfo.frequency.value = 0.6 + Math.random() * 0.3;
    const lfoGain = audioCtx.createGain();
    lfoGain.gain.value = 0.12;
    lfo.connect(lfoGain);
    lfoGain.connect(voiceGain.gain);
    osc.connect(voiceGain);
    voiceGain.connect(filter);
    osc.start();
    lfo.start();
    oscillators.push(osc, lfo);
  }

  return {
    setVolume: (v) => gain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.05),
    stop: () => {
      for (const osc of oscillators) {
        try {
          osc.stop();
        } catch {
          /* already stopped */
        }
        osc.disconnect();
      }
      filter.disconnect();
      gain.disconnect();
    },
  };
}

/** Short randomized chirps via scheduled bursts — a cheap cricket-song approximation. */
function cricketsVoice(audioCtx: AudioContext, destination: AudioNode, initialVolume: number): AmbientVoice {
  const gain = audioCtx.createGain();
  gain.gain.value = initialVolume;
  gain.connect(destination);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const chirp = () => {
    if (stopped) return;
    const now = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 4200 + Math.random() * 400;
      const burstGain = audioCtx.createGain();
      const start = now + i * 0.09;
      burstGain.gain.setValueAtTime(0, start);
      burstGain.gain.linearRampToValueAtTime(0.9, start + 0.01);
      burstGain.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
      osc.connect(burstGain);
      burstGain.connect(gain);
      osc.start(start);
      osc.stop(start + 0.08);
    }
    timer = setTimeout(chirp, 1200 + Math.random() * 1800);
  };
  chirp();

  return {
    setVolume: (v) => gain.gain.setTargetAtTime(v, audioCtx.currentTime, 0.05),
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      gain.disconnect();
    },
  };
}

/** Starts a synthesized placeholder loop for one ambient id, at the given initial volume (0-1). */
export function startSynthesizedAmbient(
  id: SukoonAmbientId,
  destination: AudioNode,
  initialVolume: number,
): AmbientVoice {
  const audioCtx = getAudioContext();
  switch (id) {
    case "rain":
      return filteredNoiseVoice(audioCtx, destination, "bandpass", 3200, 0.6, initialVolume);
    case "fan":
      return filteredNoiseVoice(audioCtx, destination, "lowpass", 450, 0.9, initialVolume);
    case "tanpura":
      return tanpuraVoice(audioCtx, destination, initialVolume);
    case "crickets":
      return cricketsVoice(audioCtx, destination, initialVolume);
  }
}
