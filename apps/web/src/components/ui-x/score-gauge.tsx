const BANDS = [
  { from: 0, to: 40, color: "var(--coral)" },
  { from: 40, to: 70, color: "var(--marigold)" },
  { from: 70, to: 100, color: "var(--tulsi)" },
];

const CX = 100;
const CY = 100;
const R = 78;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy - r * Math.sin(angleRad) };
}

function describeArc(cx: number, cy: number, r: number, startPct: number, endPct: number) {
  const startAngle = 180 - (startPct / 100) * 180;
  const endAngle = 180 - (endPct / 100) * 180;
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArcFlag = endPct - startPct > 50 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

function bandColorForValue(value: number) {
  return (BANDS.find((band) => value <= band.to) ?? BANDS[BANDS.length - 1]).color;
}

/**
 * The Rubric Dial — this app's signature score treatment (see
 * .claude/skills/frontend-design/SKILL.md). A graduated 180deg gauge with a
 * coral -> marigold -> tulsi band, read like an exam-hall meter rather than
 * a generic progress ring: the band is a fixed, always-fully-visible scale
 * (like a speedometer's colored zones), and a single needle marks the
 * current value on it — never a second value-arc stacked on top of the
 * band, which used to read as two overlapping charts.
 */
export function ScoreGauge({
  value,
  label,
  size = 168,
}: {
  value: number | null;
  label?: string;
  size?: number;
}) {
  const clamped = value === null ? 0 : Math.max(0, Math.min(100, value));
  const activeColor = bandColorForValue(clamped);
  const ticks = Array.from({ length: 11 }, (_, i) => i * 10);
  const needle = polarToCartesian(CX, CY, R, 180 - (clamped / 100) * 180);

  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg
        viewBox="0 0 200 118"
        className="w-full"
        role="img"
        aria-label={label ? `${label}: ${value === null ? "no data" : `${Math.round(value)} percent`}` : undefined}
      >
        {BANDS.map((band) => (
          <path
            key={band.from}
            d={describeArc(CX, CY, R, band.from, band.to)}
            stroke={band.color}
            strokeOpacity={0.85}
            strokeWidth={14}
            strokeLinecap="round"
            fill="none"
          />
        ))}
        {ticks.map((tick) => {
          const angle = 180 - (tick / 100) * 180;
          const inner = polarToCartesian(CX, CY, R - 11, angle);
          const outer = polarToCartesian(CX, CY, R + 11, angle);
          return (
            <line
              key={tick}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke="var(--card)"
              strokeOpacity={0.6}
              strokeWidth={2}
            />
          );
        })}
        {value !== null && (
          <circle cx={needle.x} cy={needle.y} r={7} fill={activeColor} stroke="var(--card)" strokeWidth={2.5} />
        )}
      </svg>
      <div className="-mt-7 flex flex-col items-center gap-0.5">
        <span className="font-display text-3xl" style={{ color: value === null ? "var(--muted-foreground)" : activeColor }}>
          {value === null ? "—" : `${Math.round(value)}%`}
        </span>
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}
