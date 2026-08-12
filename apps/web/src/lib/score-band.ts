const BANDS = [
  { max: 40, fill: "var(--coral)", text: "var(--coral-foreground)" },
  { max: 70, fill: "var(--marigold)", text: "var(--marigold-foreground)" },
  { max: Infinity, fill: "var(--tulsi)", text: "var(--tulsi-foreground)" },
];

function band(pct: number) {
  return BANDS.find((b) => pct <= b.max) ?? BANDS[BANDS.length - 1];
}

/**
 * Coral -> marigold -> tulsi banding, matching the Rubric Dial (score-gauge.tsx).
 *
 * FILL ONLY — a bar, an arc, a chart cell. These are the raw vivid tokens, and
 * as TEXT on a card they measure 3.67 / 1.56 / 2.54 in light mode against a
 * 4.5:1 floor (coral is 4.19 in dark too). Use scoreBandTextColor for anything
 * a reader has to read; this is the paired-token rule the design skill calls
 * this codebase's most-repeated defect.
 */
export function scoreBandColor(pct: number): string {
  return band(pct).fill;
}

/**
 * The same banding for TEXT — the paired -foreground shade, which is a dark
 * shade in light mode and a light one in dark. Measured on the card: 8.06 /
 * 7.63 / 8.02 light, 11.99 / 11.99 / 10.90 dark.
 *
 * Keeps the score's colour signal (a 55% still reads amber, a 90% still reads
 * green) while actually being legible, so this is not a downgrade to plain
 * foreground — it is the same message at a readable weight.
 */
export function scoreBandTextColor(pct: number): string {
  return band(pct).text;
}
