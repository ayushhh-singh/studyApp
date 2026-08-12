import type { CSSProperties } from "react";

/**
 * The four accent tints, and the ONE right way to paint text on a solid fill of
 * each.
 *
 * ⚑ WHY THIS EXISTS. The obvious-looking pairing — a raw accent as the
 * background with that accent's `-foreground` token as the text — is wrong, and
 * it was live on all eight `/features/*` pages. Those `-foreground` shades are
 * calibrated for the accent's `/15` TINT, not for the solid colour, and in dark
 * mode they flip light while marigold/tulsi/coral do not. Measured:
 *
 *              raw fill + `-foreground` text      this module
 *   light  marigold 5.16   tulsi 3.01 ✗  coral 2.40 ✗      10.74 / 6.61 / 4.56
 *   dark   marigold 1.22 ✗ tulsi 1.50 ✗  coral 1.91 ✗      10.74 / 8.72 / 6.23
 *
 * Six of eight combinations failed AA; marigold in dark was 1.22:1, i.e.
 * invisible. This is the defect the design skill calls the single
 * most-repeated one in the codebase, and it has now been fixed app-wide three
 * times — so the fix here is a helper rather than another round of literals.
 *
 * THE RULE, and it is simpler than it looks: every accent fill in this palette
 * is a light or mid value, so **text on a solid accent is always
 * `--brand-navy`** — which is exactly what the design system already mandates
 * for gold, generalised to the other three on measurement rather than on
 * gold being a special case.
 *
 * `--primary` is the one exception and needs no help: it is a DEEP blue in
 * light and a pale blue in dark, and its `--primary-foreground` already flips
 * with it (6.61:1 light, 6.95:1 dark).
 *
 * Use {@link accentSolid} for a saturated chip/badge/step marker, and
 * {@link accentTint} for the quiet `/15` wash behind an icon — that one is the
 * pairing `-foreground` WAS calibrated for, so it stays correct.
 */
export type Accent = "primary" | "marigold" | "tulsi" | "coral";

/** Saturated fill + a text/icon colour guaranteed >= 4.5:1 on it, in both themes. */
export function accentSolid(accent: Accent): CSSProperties {
  return {
    backgroundColor: `var(--${accent})`,
    color: accent === "primary" ? "var(--primary-foreground)" : "var(--brand-navy)",
  };
}

/** The quiet `/15` wash + its calibrated `-foreground` partner. */
export function accentTint(accent: Accent): CSSProperties {
  return {
    backgroundColor: `color-mix(in oklch, var(--${accent}) 15%, transparent)`,
    color: accent === "primary" ? "var(--primary)" : `var(--${accent}-foreground)`,
  };
}
