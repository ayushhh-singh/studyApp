import { cn } from "@/lib/utils";

/**
 * Wordmark: a compact Rubric-Dial glyph (the app's signature arc gauge, echoing
 * score-gauge.tsx) + the "PrayasUP" wordmark. Used on the landing hero, auth,
 * and onboarding. Pure SVG + tokens, no external asset.
 */
export function BrandMark({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 40 40" className="size-8 shrink-0" aria-hidden>
        {/* graduated arc: coral -> marigold -> tulsi, an exam-hall meter */}
        <path d="M6 28 A16 16 0 0 1 34 28" fill="none" stroke="currentColor" className="text-border" strokeWidth="4" strokeLinecap="round" />
        <path d="M6 28 A16 16 0 0 1 15 14.2" fill="none" stroke="var(--coral)" strokeWidth="4" strokeLinecap="round" />
        <path d="M15 14.2 A16 16 0 0 1 25 14.2" fill="none" stroke="var(--marigold)" strokeWidth="4" />
        <path d="M25 14.2 A16 16 0 0 1 34 28" fill="none" stroke="var(--tulsi)" strokeWidth="4" strokeLinecap="round" />
        {/* needle */}
        <line x1="20" y1="28" x2="26" y2="17" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="20" cy="28" r="2.5" fill="var(--primary)" />
      </svg>
      {showText ? (
        <span className="text-lg font-extrabold tracking-tight text-foreground">
          Prayas<span className="text-primary">UP</span>
        </span>
      ) : null}
    </span>
  );
}
