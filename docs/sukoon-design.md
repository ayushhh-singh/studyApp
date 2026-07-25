# Sukoon design system — state-aware vibrancy

Sukoon's visual language sits on the calm **indigo / teal / sand** palette
(`apps/web/src/sukoon/theme/index.css`). The 2026 overhaul added a warm accent
layer **on top of** that base — it did not replace it. The whole point of the
system is *when* colour is allowed to get lively, not just which colours exist.

## The two layers

### 1. Calm layer (default, everywhere)
- **Base:** warm paper/sand background (`--background` `#F4EDE3`), deep indigo
  foreground/primary (`--primary` `#2E2A5E`), soft teal accent (`--secondary`
  `#4FB3A9`).
- This is the *only* palette allowed on **check-ins, mood logging, difficult
  journal entries, and every crisis-adjacent surface** (the inline helpline
  card, the crisis takeover). These screens never brighten based on how vibrant
  the rest of the app looks.
- Motion here is slow and quiet: `--sukoon-transition-slow: 700ms`, gentle
  fades, no pops.

### 2. Joy layer (positive moments only)
- A single **warm, saturated coral** accent used as ambient *lighting* — soft
  radial glows and a coral→apricot gradient, **never a flat coral block**.
- Tokens (`--sukoon-joy*`, defined for both `.sukoon` and `.sukoon-dark`):
  - `--sukoon-joy` — decorative scale only (large icons, the gradient ring).
  - `--sukoon-joy-strong` — the AA-passing shade for anything a screen must
    *read* (`#b23a22` light = ≥5:1 on sand/white/accent; `#ffb3a0` dark = ≥9:1).
  - `--sukoon-joy-foreground` — a deep warm glyph colour (`#2a1410`) for a mark
    sitting on the gradient (6.8–9.9:1 there — legible, not a washed-out white).
  - `--sukoon-joy-from/-to` — the coral→apricot gradient stops.
  - `--sukoon-joy-soft` / `--sukoon-joy-glow` — the faint wash tint and the
    radial-glow centre.
- Ambient utility classes: `.sukoon-joy-glow` (radial glow), `.sukoon-joy-gradient`
  (warm ring/fill), `.sukoon-joy-wash` (faint light spilling from the top edge).
- Motion: `.sukoon-bloom` (a slow ease-open + tiny overshoot, like an exhale —
  **not** confetti), `.sukoon-glow-breathe` (a 4.5s breathing pulse behind the
  glow), `.sukoon-rise` / `.sukoon-rise-slow` (a gentle fade + rise for copy).

## Where the joy layer is allowed
Reserved for **genuinely positive moments**, rendered only via the primitives in
`sukoon/components/sukoon-celebrate.tsx` (`<JoyBadge/>`, `<JoyGlow/>`):

| Surface | Treatment |
| --- | --- |
| Exercise completion (breathing / PMR / meditation / grounding / timer) | `CompletionScreen` → `<JoyBadge/>` medallion + wash + bloom |
| Journey day / journey complete | same `CompletionScreen` |
| Active journaling streak (`current > 0`) | warm `sukoon-joy-wash` chip, day count in `--sukoon-joy-strong` |
| Voice-session end, milestones | `<JoyBadge/>` / wash |

## Where it is forbidden (calm, always)
Mood check-in (`mood.tsx`), the two check-ins (`checkin/*`), the crisis inline
card and takeover, the "start a streak" (zero) chip, and the Saathi chat body.
Chat gets only a slow entrance (`sukoon-rise`) — never the joy accent — because
a conversation can turn crisis-adjacent at any turn.

> **Why this matters:** a wellness app that celebrates a *low* mood log with a
> burst of colour is a real, documented emotional-tone mismatch. Vibrancy in
> Sukoon is opt-in per moment, never a global coat of paint.

## Whitespace
The Home screen (`pages/home.tsx`) is deliberately spacious: a quiet greeting,
**one** row of essential actions (check in · breathe · Saathi), then the richer
cards demoted into a roomy "your space" section (`gap-10` between blocks). The
first screen should feel like a first breath, not a control panel.

## Haptics (breathing exercises)
See `sukoon/lib/sukoon-haptics.ts` for the full platform honesty note. Summary:
- Breathing phases pulse via the Web **Vibration API** — a rising double-tap to
  inhale, one long soft buzz to exhale, a light tick on a hold.
- **Android** Chrome/Firefox/Samsung Internet (and installed Android PWAs):
  fully supported — this is most of our budget-Android base, so it genuinely
  lands.
- **iOS** (Safari *and* every other iOS browser — all WebKit): `navigator.vibrate`
  is not implemented, a permanent silent no-op. We do not fake it or fall back
  to sound. The haptics toggle is **hidden** on platforms that can't honour it,
  rather than offering a switch that lies.
- Haptics are an *enhancement*, never load-bearing: the visual circle and the
  countdown always carry the pacing on their own.

## Accessibility floor (non-negotiable, verified)
- Every joy text/glyph colour meets WCAG 2.1 AA in **both** themes (contrasts
  computed above; large display numerals meet ≥3:1, normal text ≥4.5:1).
- Focus-visible rings on all new interactive surfaces (`--ring`, offset).
- Tap targets ≥44px on the new/updated CTAs (`min-h-11`, `size-11`).
- All motion is `prefers-reduced-motion`-aware (keyframes neutralised by the
  global override; the one transition-based effect — button press — is wrapped
  in a `no-preference` guard).
- Decorative layers (`<JoyGlow/>`, the badge glow, emoji) are `aria-hidden`;
  the phase label on the breathing circle stays the only `aria-live` region.
