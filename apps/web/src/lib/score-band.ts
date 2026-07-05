const BANDS = [
  { max: 40, color: "var(--coral)" },
  { max: 70, color: "var(--marigold)" },
  { max: Infinity, color: "var(--tulsi)" },
];

/** Coral -> marigold -> tulsi banding, matching the Rubric Dial (score-gauge.tsx). */
export function scoreBandColor(pct: number): string {
  return (BANDS.find((band) => pct <= band.max) ?? BANDS[BANDS.length - 1]).color;
}
