import type { SukoonGardenStageId } from "@neev/shared";
import { cn } from "@/lib/utils";

/**
 * Sukoon F11 — the Garden's hand-drawn SVG plant. Custom (no shadcn
 * primitive fits a growth illustration), composed as five simple stage
 * drawings sharing one soil base for visual continuity as the plant
 * "grows" from one stage to the next. Deliberately calm, not a literal
 * fitness-ring/XP-bar feel (blueprint: "no gamified motion like Neev's
 * Conquest Map") — a slow, single sway loop on the leafy stages, nothing
 * else animates. `prefers-reduced-motion` is handled globally (index.css's
 * blanket animation-duration override), so no extra guard is needed here.
 */
export function SukoonGardenPlant({ stage, className }: { stage: SukoonGardenStageId; className?: string }) {
  return (
    <svg viewBox="0 0 160 160" className={cn("h-full w-full", className)} aria-hidden>
      {/* Soil, present at every stage. */}
      <ellipse cx="80" cy="138" rx="46" ry="10" className="fill-muted" />

      {stage === "seed" ? (
        <ellipse cx="80" cy="132" rx="7" ry="5" className="fill-secondary" />
      ) : null}

      {stage === "sprout" ? (
        <g className="sukoon-garden-sway" style={{ transformOrigin: "80px 128px" }}>
          <path d="M80 128 V104" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-primary" />
          <path d="M80 112 C68 108 62 114 60 122" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-secondary" />
          <path d="M80 118 C92 114 98 120 100 128" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-secondary" />
        </g>
      ) : null}

      {stage === "sapling" ? (
        <g className="sukoon-garden-sway" style={{ transformOrigin: "80px 128px" }}>
          <path d="M80 128 V78" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-primary" />
          <path d="M80 108 C64 100 56 108 52 120" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="text-secondary" />
          <path d="M80 96 C96 88 104 96 108 108" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" className="text-secondary" />
          <path d="M80 82 C70 76 66 80 64 88" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-secondary" />
          <circle cx="80" cy="76" r="10" className="fill-secondary/70" />
        </g>
      ) : null}

      {stage === "tree" ? (
        <g className="sukoon-garden-sway" style={{ transformOrigin: "80px 128px" }}>
          <path d="M80 128 V64" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className="text-primary" />
          <path d="M80 96 C58 86 50 98 48 112" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-secondary" />
          <path d="M80 84 C104 74 114 86 116 100" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-secondary" />
          <circle cx="80" cy="58" r="26" className="fill-secondary/80" />
          <circle cx="60" cy="72" r="16" className="fill-secondary/60" />
          <circle cx="102" cy="72" r="16" className="fill-secondary/60" />
        </g>
      ) : null}

      {stage === "blooming" ? (
        <g className="sukoon-garden-sway" style={{ transformOrigin: "80px 128px" }}>
          <path d="M80 128 V60" stroke="currentColor" strokeWidth="5" strokeLinecap="round" className="text-primary" />
          <path d="M80 92 C56 82 48 94 46 110" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-secondary" />
          <path d="M80 80 C106 70 116 82 118 98" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="text-secondary" />
          <circle cx="80" cy="54" r="28" className="fill-secondary/80" />
          <circle cx="56" cy="70" r="17" className="fill-secondary/60" />
          <circle cx="104" cy="70" r="17" className="fill-secondary/60" />
          {/* A few small blooms — the only spot of warmth against the calm teal canopy. */}
          <circle cx="66" cy="46" r="4" className="fill-destructive/70" />
          <circle cx="94" cy="42" r="4" className="fill-destructive/70" />
          <circle cx="80" cy="66" r="4" className="fill-destructive/70" />
          <circle cx="52" cy="66" r="3.5" className="fill-destructive/70" />
          <circle cx="108" cy="60" r="3.5" className="fill-destructive/70" />
        </g>
      ) : null}
    </svg>
  );
}
