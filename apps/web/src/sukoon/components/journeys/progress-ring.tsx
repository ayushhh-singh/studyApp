/**
 * Sukoon F7 — a small hand-rolled SVG progress ring for the journey catalog
 * cards (blueprint: "journey cards with progress rings"). Custom, not a
 * shadcn primitive (none exists for a circular ring) — kept deliberately
 * calm/plain, matching the F6 players' "no gamified motion" convention rather
 * than Neev's own Rubric Dial (a different product's branding).
 */
export function ProgressRing({
  value,
  size = 40,
  strokeWidth = 4,
}: {
  /** 0-100. */
  value: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className="stroke-muted"
      />
      {clamped > 0 ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="stroke-secondary transition-[stroke-dashoffset] duration-500"
        />
      ) : null}
    </svg>
  );
}
