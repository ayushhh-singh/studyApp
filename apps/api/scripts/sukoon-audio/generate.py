#!/usr/bin/env python3
"""
Sukoon F6 — first-party ambient / meditation audio GENERATOR.

Every file this produces is an ORIGINAL work synthesized here from scratch
(numpy DSP -> MP3 via lameenc). Nothing is sampled, downloaded, or derived from
any third-party recording, so there is no external licence to honour: Neev owns
these outright (see README.md — this is the "checkable commercial licence" the
SUKOON_CONTEXT hard rule demands). Swap any of these for a professionally
recorded, properly licensed library track later — the app prefers whatever real
file is present and needs no code change (real-file-with-synth-fallback design).

Outputs (deterministic — a fixed RNG seed makes regeneration byte-stable):
  build/bucket/ambient/{rain,fan,crickets,tanpura}.mp3   -> sukoon-audio bucket (loops)
  build/bucket/meditations/{deep-calm,morning-light,ocean-drift}.mp3 -> bucket (full tracks)
  build/static/{singing-bowl,breath-inhale,breath-exhale,breath-hold}.mp3
                                                          -> apps/web/public/sukoon/audio (bundled)

Requires: numpy, scipy, lameenc  (pip install numpy scipy lameenc)
Run:      python3 generate.py     (writes into ./build next to this file)
"""
from __future__ import annotations

import os
import struct
import numpy as np
from scipy.signal import butter, sosfilt
import lameenc

SR = 44100
RNG = np.random.default_rng(20260725)  # fixed seed -> reproducible renders
HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------
def t_axis(seconds: float) -> np.ndarray:
    return np.arange(int(seconds * SR), dtype=np.float64) / SR


def normalize(x: np.ndarray, peak: float = 0.89) -> np.ndarray:
    m = float(np.max(np.abs(x))) or 1.0
    return x * (peak / m)


def fade(x: np.ndarray, fin: float = 0.02, fout: float = 0.02) -> np.ndarray:
    n = len(x)
    ni, no = int(fin * SR), int(fout * SR)
    if ni:
        x[:ni] *= np.linspace(0.0, 1.0, ni)
    if no:
        x[-no:] *= np.linspace(1.0, 0.0, no)
    return x


def seamless_loop(x: np.ndarray, crossfade_s: float = 2.0) -> np.ndarray:
    """Equal-power crossfade the tail onto the head so the file loops with no
    click. Input must be `loop_len + crossfade` long; output is `loop_len`."""
    c = int(crossfade_s * SR)
    body = x[:-c].copy()
    tail = x[-c:]
    ramp = np.linspace(0.0, 1.0, c)
    # equal-power (sin/cos) crossfade preserves perceived loudness through the seam
    body[:c] = body[:c] * np.sin(ramp * np.pi / 2) ** 2 + tail * np.cos(ramp * np.pi / 2) ** 2
    return body


def bandpass(x, lo, hi, order=4):
    sos = butter(order, [lo / (SR / 2), hi / (SR / 2)], btype="band", output="sos")
    return sosfilt(sos, x)


def lowpass(x, cut, order=4):
    sos = butter(order, cut / (SR / 2), btype="low", output="sos")
    return sosfilt(sos, x)


def highpass(x, cut, order=2):
    sos = butter(order, cut / (SR / 2), btype="high", output="sos")
    return sosfilt(sos, x)


def _comb_feedback(x: np.ndarray, delay: int, g: float) -> np.ndarray:
    """y[i] = x[i] + g*y[i-delay], computed block-by-block (each block reads the
    already-finished previous block) so it stays O(N) instead of scipy.lfilter's
    O(N*delay) for a long-delay IIR — the difference between seconds and hours
    on a 5-minute track."""
    y = x.astype(np.float64, copy=True)
    for start in range(delay, len(y), delay):
        end = min(start + delay, len(y))
        y[start:end] += g * y[start - delay : start - delay + (end - start)]
    return y


def schroeder_reverb(x: np.ndarray, mix: float = 0.28) -> np.ndarray:
    """Small Schroeder reverb (4 parallel combs -> 2 series allpass). Adds the
    sense of a calm, spacious room — the single biggest quality lift for
    sustained meditation pads. Vectorised via _comb_feedback (see there)."""
    combs = [(1557, 0.80), (1617, 0.79), (1491, 0.83), (1422, 0.81)]
    wet = np.zeros_like(x, dtype=np.float64)
    for delay, g in combs:
        wet += _comb_feedback(x, delay, g)
    wet /= len(combs)
    for delay, g in [(225, 0.7), (556, 0.7)]:
        w = _comb_feedback(wet, delay, g)          # feedback part
        delayed = np.concatenate([np.zeros(delay), w[:-delay]])
        wet = -g * w + delayed                      # + feedforward -> allpass
    return (1 - mix) * x + mix * wet


def encode_mp3(x: np.ndarray, path: str, bitrate: int) -> int:
    """Mono float [-1,1] -> MP3. Returns bytes written."""
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767.0).astype("<i2").tobytes()
    enc = lameenc.Encoder()
    enc.set_bit_rate(bitrate)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)  # 2 = high quality / slower
    data = enc.encode(pcm) + enc.flush()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return len(data)


# ---------------------------------------------------------------------------
# Ambient beds (loopable) — the mixer's rain / fan / crickets / tanpura
# ---------------------------------------------------------------------------
def gen_rain(loop_s=75.0) -> np.ndarray:
    n_s = loop_s + 2.0
    n = int(n_s * SR)
    noise = RNG.standard_normal(n)
    hiss = bandpass(noise, 800, 7000) * 0.7          # the fine "shhh" of rain
    body = lowpass(RNG.standard_normal(n), 900) * 0.5  # low rumble/patter body
    # slow, gentle intensity drift so it breathes rather than sits static
    drift = 0.85 + 0.15 * np.sin(2 * np.pi * 0.03 * t_axis(n_s))
    x = (hiss + body) * drift
    # sparse close droplets — short filtered noise bursts
    for _ in range(int(loop_s * 5)):
        start = RNG.integers(0, n - 4000)
        L = int(RNG.integers(400, 1400))
        burst = bandpass(RNG.standard_normal(L), 1500, 5000)
        burst *= np.exp(-np.linspace(0, 6, L)) * 0.5
        x[start:start + L] += burst
    return normalize(seamless_loop(x, 2.0), 0.82)


def gen_fan(loop_s=60.0) -> np.ndarray:
    n_s = loop_s + 2.0
    n = int(n_s * SR)
    air = lowpass(RNG.standard_normal(n), 520) * 0.9   # steady air whoosh
    ta = t_axis(n_s)
    # faint blade hum with slight amplitude wobble (a real fan's periodicity)
    hum = 0.10 * np.sin(2 * np.pi * 96 * ta) * (1 + 0.2 * np.sin(2 * np.pi * 4.5 * ta))
    x = air + hum
    return normalize(seamless_loop(x, 2.0), 0.8)


def gen_crickets(loop_s=60.0) -> np.ndarray:
    n_s = loop_s + 2.0
    n = int(n_s * SR)
    x = lowpass(RNG.standard_normal(n), 300) * 0.05    # low night-air bed
    # several individual crickets at slightly different pitch / chirp cadence
    for _ in range(7):
        base = 4000 + RNG.uniform(-500, 700)
        period = RNG.uniform(0.9, 1.8)
        gain = RNG.uniform(0.15, 0.32)
        pos = RNG.uniform(0, period)
        while pos < n_s - 0.2:
            start = int(pos * SR)
            # a chirp = a few fast pulses
            for k in range(RNG.integers(2, 4)):
                L = 700
                s = start + int(k * 0.09 * SR)
                if s + L >= n:
                    break
                env = np.exp(-np.linspace(0, 7, L))
                tone = np.sin(2 * np.pi * base * (np.arange(L) / SR)) * env * gain
                x[s:s + L] += tone
            pos += period * RNG.uniform(0.8, 1.25)
    return normalize(seamless_loop(x, 2.0), 0.72)


def karplus_strong(freq: float, dur_s: float, decay: float = 0.996) -> np.ndarray:
    """A plucked-string voice — gives the tanpura its real shimmering timbre
    (far closer than a raw sawtooth)."""
    N = int(SR / freq)
    buf = RNG.standard_normal(N)
    out = np.empty(int(dur_s * SR))
    idx = 0
    for i in range(len(out)):
        out[i] = buf[idx]
        nxt = (idx + 1) % N
        buf[idx] = decay * 0.5 * (buf[idx] + buf[nxt])
        idx = nxt
    return out


def gen_tanpura(loop_s=48.0) -> np.ndarray:
    # Classic Pa–Sa–Sa–Sa tuning (a fifth then three tonics across octaves).
    strings = [98.0, 130.8, 130.8, 65.4]  # G2, C3, C3, C2
    n_s = loop_s + 3.0
    n = int(n_s * SR)
    x = np.zeros(n)
    pluck_gap = 1.15  # seconds between successive string plucks (the tanpura cycle)
    plucks = {}
    for s_i, f in enumerate(strings):
        v = karplus_strong(f, 3.2)
        v = fade(v, 0.005, 0.4)
        plucks[s_i] = normalize(v, 0.6)
    pos = 0.0
    si = 0
    while pos < n_s - 3.2:
        v = plucks[si % len(strings)]
        start = int(pos * SR)
        end = min(start + len(v), n)
        x[start:end] += v[: end - start] * RNG.uniform(0.85, 1.0)
        pos += pluck_gap * RNG.uniform(0.96, 1.05)
        si += 1
    x = lowpass(x, 2200)                 # tame the pluck edge -> warm hum
    x = schroeder_reverb(x, mix=0.18)
    return normalize(seamless_loop(x, 2.5), 0.72)


# ---------------------------------------------------------------------------
# Meditation soundscapes (full instrumental tracks — language-neutral)
# ---------------------------------------------------------------------------
def pad_voice(freq: float, dur_s: float, detune=0.4, bright=1) -> np.ndarray:
    """A warm additive-sine pad note with gentle detune + slow vibrato."""
    ta = t_axis(dur_s)
    vib = 1 + 0.003 * np.sin(2 * np.pi * 0.18 * ta)  # slow, subtle vibrato
    out = np.zeros(len(ta))
    partials = [(1, 1.0), (2, 0.28 * bright), (3, 0.12 * bright), (4, 0.05 * bright)]
    for cents in (-detune, detune):
        f = freq * (2 ** (cents / 1200))
        for mult, amp in partials:
            out += amp * np.sin(2 * np.pi * f * mult * ta * vib)
    return out / (len(partials) * 2)


def chord_track(chords, seg_s: float, dur_s: float, bright=1.0) -> np.ndarray:
    """Cross-faded chord bed: each chord swells in/out over `seg_s` and overlaps
    its neighbour, so harmony drifts continuously with no seams."""
    n = int(dur_s * SR)
    x = np.zeros(n)
    seg = int(seg_s * SR)
    half = seg // 2
    env = np.sin(np.linspace(0, np.pi, seg)) ** 2  # raised-sine swell (in & out)
    pos = 0
    ci = 0
    while pos < n:
        chord = chords[ci % len(chords)]
        voices = sum(pad_voice(f, seg / SR, bright=bright) for f in chord) / len(chord)
        seg_sig = voices * env
        end = min(pos + seg, n)
        x[pos:end] += seg_sig[: end - pos]
        pos += half  # 50% overlap
        ci += 1
    return x


def note(name: str) -> float:
    names = {"C": -9, "C#": -8, "D": -7, "D#": -6, "E": -5, "F": -4, "F#": -3,
             "G": -2, "G#": -1, "A": 0, "A#": 1, "B": 2}
    pitch = name[:-1]
    octave = int(name[-1])
    semis = names[pitch] + (octave - 4) * 12
    return 440.0 * (2 ** (semis / 12))


def gen_deep_calm(dur_s=330.0) -> np.ndarray:
    # Low, warm minor-ish drift — grounding.
    N = lambda s: note(s)
    chords = [
        [N("C2"), N("C3"), N("G3"), N("D#4")],
        [N("A1"), N("A2"), N("E3"), N("C4")],
        [N("F2"), N("C3"), N("F3"), N("A3")],
        [N("G2"), N("D3"), N("G3"), N("A#3")],
    ]
    x = chord_track(chords, seg_s=26.0, dur_s=dur_s, bright=0.7)
    x = lowpass(x, 1600)
    x = schroeder_reverb(x, mix=0.30)
    return normalize(fade(x, 4.0, 6.0), 0.7)


def gen_morning_light(dur_s=330.0) -> np.ndarray:
    # Brighter major-key pad with occasional high shimmer — uplifting calm.
    N = lambda s: note(s)
    chords = [
        [N("C3"), N("E3"), N("G3"), N("D4")],
        [N("G2"), N("D3"), N("G3"), N("B3")],
        [N("A2"), N("E3"), N("A3"), N("C#4")],
        [N("F2"), N("C3"), N("F3"), N("A3")],
    ]
    x = chord_track(chords, seg_s=24.0, dur_s=dur_s, bright=1.25)
    x = highpass(x, 90)
    # sparse high sine sparkles
    ta = t_axis(dur_s)
    n = len(x)
    for _ in range(int(dur_s / 9)):
        start = int(RNG.uniform(0, dur_s - 3) * SR)
        L = int(2.5 * SR)
        f = note(RNG.choice(["C6", "E6", "G6", "D6"]))
        env = np.exp(-np.linspace(0, 4, L))
        x[start:start + L] += 0.06 * np.sin(2 * np.pi * f * (np.arange(L) / SR)) * env
    x = schroeder_reverb(x, mix=0.32)
    return normalize(fade(x, 3.0, 6.0), 0.72)


def gen_ocean_drift(dur_s=330.0) -> np.ndarray:
    # Slow noise "wave sets" over a low warm pad — the classic seaside bed.
    n = int(dur_s * SR)
    ta = t_axis(dur_s)
    surf = bandpass(RNG.standard_normal(n), 200, 2400)
    # wave-set LFO: sets of swells (~0.09 Hz) inside a slower tide (~0.02 Hz)
    lfo = (0.5 + 0.5 * np.sin(2 * np.pi * 0.09 * ta - np.pi / 2)) ** 1.6
    tide = 0.6 + 0.4 * np.sin(2 * np.pi * 0.021 * ta)
    waves = surf * lfo * tide * 0.8
    N = lambda s: note(s)
    pad = chord_track([[N("C2"), N("G2"), N("C3")], [N("A1"), N("E2"), N("A2")]],
                      seg_s=30.0, dur_s=dur_s, bright=0.5)
    pad = lowpass(pad, 700) * 0.6
    x = waves + pad
    x = schroeder_reverb(x, mix=0.22)
    return normalize(fade(x, 4.0, 6.0), 0.72)


# ---------------------------------------------------------------------------
# One-shots — singing-bowl chime + breathing cues (tiny, bundled statically)
# ---------------------------------------------------------------------------
def gen_singing_bowl(dur_s=7.0) -> np.ndarray:
    ta = t_axis(dur_s)
    fundamental = 261.0
    partials = [(1.0, 1.0), (2.75, 0.55), (5.38, 0.30), (8.9, 0.16), (13.3, 0.08)]
    x = np.zeros(len(ta))
    for ratio, amp in partials:
        decay = np.exp(-ta * (0.5 + ratio * 0.10))
        beat = 1 + 0.06 * np.sin(2 * np.pi * (0.8 + ratio) * ta)  # subtle bowl shimmer/beating
        x += amp * decay * beat * np.sin(2 * np.pi * fundamental * ratio * ta)
    strike = np.exp(-ta * 60) * bandpass(RNG.standard_normal(len(ta)), 2000, 8000) * 0.25
    x = x + strike
    x = schroeder_reverb(x, mix=0.15)
    return normalize(fade(x, 0.002, 1.5), 0.85)


def gen_breath_inhale(dur_s=3.6) -> np.ndarray:
    ta = t_axis(dur_s)
    # a soft airy tone rising gently in pitch + a swelling breath of filtered noise
    f = 196 * (2 ** (np.linspace(0, 5, len(ta)) / 12))  # ~+5 semitones over the phase
    tone = 0.5 * np.sin(2 * np.pi * np.cumsum(f) / SR)
    breath = lowpass(RNG.standard_normal(len(ta)), 1200) * np.linspace(0.0, 0.35, len(ta))
    env = np.sin(np.linspace(0, np.pi, len(ta))) ** 1.2
    x = (tone + breath) * env
    x = schroeder_reverb(x, mix=0.18)
    return normalize(fade(x, 0.03, 0.25), 0.6)


def gen_breath_exhale(dur_s=4.2) -> np.ndarray:
    ta = t_axis(dur_s)
    f = 196 * (2 ** (np.linspace(5, 0, len(ta)) / 12))  # falling, mirror of inhale
    tone = 0.5 * np.sin(2 * np.pi * np.cumsum(f) / SR)
    breath = lowpass(RNG.standard_normal(len(ta)), 900) * np.linspace(0.35, 0.0, len(ta))
    env = np.sin(np.linspace(0, np.pi, len(ta))) ** 1.2
    x = (tone + breath) * env
    x = schroeder_reverb(x, mix=0.18)
    return normalize(fade(x, 0.05, 0.4), 0.6)


def gen_breath_hold(dur_s=0.9) -> np.ndarray:
    # a very soft, short bell tick marking the start of a hold
    ta = t_axis(dur_s)
    x = np.exp(-ta * 8) * np.sin(2 * np.pi * 523.25 * ta) * 0.5
    x += np.exp(-ta * 9) * np.sin(2 * np.pi * 783.99 * ta) * 0.25
    return normalize(fade(x, 0.002, 0.2), 0.5)


# ---------------------------------------------------------------------------
# Render
# ---------------------------------------------------------------------------
BUCKET_TASKS = [
    # (subpath, fn, bitrate)
    ("ambient/rain.mp3", gen_rain, 64),
    ("ambient/fan.mp3", gen_fan, 64),
    ("ambient/crickets.mp3", gen_crickets, 64),
    ("ambient/tanpura.mp3", gen_tanpura, 72),
    ("meditations/deep-calm.mp3", gen_deep_calm, 72),
    ("meditations/morning-light.mp3", gen_morning_light, 80),
    ("meditations/ocean-drift.mp3", gen_ocean_drift, 72),
]
STATIC_TASKS = [
    ("singing-bowl.mp3", gen_singing_bowl, 128),
    ("breath-inhale.mp3", gen_breath_inhale, 112),
    ("breath-exhale.mp3", gen_breath_exhale, 112),
    ("breath-hold.mp3", gen_breath_hold, 112),
]


def main() -> None:
    total = 0
    print("Rendering bucket audio (ambient loops + meditation soundscapes)...")
    for sub, fn, br in BUCKET_TASKS:
        sig = fn()
        path = os.path.join(BUILD, "bucket", sub)
        size = encode_mp3(sig, path, br)
        total += size
        print(f"  {sub:34s} {len(sig)/SR:6.1f}s  {br:3d}kbps  {size/1024:8.1f} KB")
    print("Rendering static bundled assets (chime + breath cues)...")
    for name, fn, br in STATIC_TASKS:
        sig = fn()
        path = os.path.join(BUILD, "static", name)
        size = encode_mp3(sig, path, br)
        total += size
        print(f"  {name:34s} {len(sig)/SR:6.1f}s  {br:3d}kbps  {size/1024:8.1f} KB")
    print(f"\nTotal rendered: {total/1024/1024:.2f} MB")


if __name__ == "__main__":
    main()
