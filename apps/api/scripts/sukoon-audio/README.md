# Sukoon audio — sourcing, licensing & pipeline

Closes the confirmed gap: before this, the `sukoon-audio` bucket held **zero
files**, so every user only ever heard the Web-Audio synth fallbacks
(`apps/web/src/sukoon/lib/sukoon-audio-synth.ts`). Real audio now exists and the
app prefers it, with the synth kept only as a genuine fallback.

## Licensing — the one thing that matters

**Every file here is an ORIGINAL first-party work**, synthesized from scratch by
`generate.py` (numpy DSP → MP3 via lameenc). Nothing is sampled from, derived
from, or downloaded from any third-party recording, library, or model output.

- **License: none required — Neev owns these outright.** This is the strongest,
  most "checkable" commercial license possible for the SUKOON_CONTEXT hard rule
  ("never use anything without a checkable commercial license, this is
  copyright-sensitive"): there is no external rights-holder to attribute, pay,
  or restrict use.
- **Why first-party instead of Pixabay/Freesound/etc.?** These were generated in
  an unattended environment where a downloaded file's license **cannot be
  verified programmatically** — Pixabay's CDN blocks direct download and has no
  audio API; Freesound mixes CC0 / CC-BY / CC-BY-**NC** (non-commercial) content
  behind an OAuth API. Shipping an un-verifiable download would violate the hard
  rule. Generating our own sidesteps the question entirely.

## Swapping in professionally-recorded library tracks later

The app is **format- and source-agnostic** — it plays whatever real file is
present and needs **no code change** to upgrade. To replace any track with a
properly-licensed library recording (Pixabay Content License, a CC0/CC-BY track
with attribution recorded here, or a paid stock subscription):

1. Drop the replacement MP3 at the same `build/…` path this script would write.
2. Re-run the upload step (below). It re-points everything idempotently.
3. If the track is CC-BY or otherwise attribution-bearing, **record the source +
   license here** so provenance stays checkable.

## What gets produced

| File | Destination | Role | ~Size |
|------|-------------|------|-------|
| `ambient/rain.mp3` | bucket (loop) | mixer bed | 586 KB |
| `ambient/fan.mp3` | bucket (loop) | mixer bed | 469 KB |
| `ambient/crickets.mp3` | bucket (loop) | mixer bed | 469 KB |
| `ambient/tanpura.mp3` | bucket (loop) | mixer bed | 379 KB |
| `meditations/deep-calm.mp3` | bucket (full) | soundscape | 2.5 MB |
| `meditations/morning-light.mp3` | bucket (full) | soundscape | 3.2 MB |
| `meditations/ocean-drift.mp3` | bucket (full) | soundscape | 2.5 MB |
| `singing-bowl.mp3` | **bundled** `apps/web/public/sukoon/audio` | start/end chime | 110 KB |
| `breath-inhale.mp3` | **bundled** | breathing cue | 50 KB |
| `breath-exhale.mp3` | **bundled** | breathing cue | 58 KB |
| `breath-hold.mp3` | **bundled** | breathing cue | 13 KB |

**Size strategy (PWA-reasonable):** only the ~230 KB of tiny cues that must play
instantly are bundled + service-worker-precached. The larger ambient/meditation
files (~10 MB) live in the private `sukoon-audio` bucket and load **lazily** —
one signed URL per exercise, fetched only on play, never bundled. Ambient beds
are short seamless loops (48–75 s); soundscapes are full 5.5-min tracks encoded
mono at 64–80 kbps.

## Regenerating

```bash
pip install numpy scipy lameenc          # one-time
python3 generate.py                      # deterministic (fixed RNG seed) → ./build
cp build/static/*.mp3 ../../../../apps/web/public/sukoon/audio/   # bundled cues
pnpm --filter api sukoon:upload-audio    # bucket files + point soundscape rows (0095)
```

`build/` (the generated MP3s) is git-ignored — the bucket is the source of truth
for the large files, and the tiny bundled cues are committed under
`apps/web/public/sukoon/audio`.
