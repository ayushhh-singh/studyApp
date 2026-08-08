import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Wordmark: "Marked Right" — an ink dot (the pen touching down) drawing into a
 * checkmark, stroked in the score gauge's own coral->marigold->tulsi gradient
 * (matches public/favicon.svg, generated via scripts/generate-pwa-icons.mjs).
 * Picked over a literal Rubric-Dial repeat because it's the one thing every
 * core surface shares — MCQs, mocks, and the flagship AI answer evaluation
 * are all, in the end, something written or answered and then marked. Used
 * on the sidebar, landing hero, auth, and onboarding. Pure SVG + tokens, no
 * external asset.
 */
export function BrandMark({ className, showText = true }: { className?: string; showText?: boolean }) {
  // Unique per instance so two BrandMarks on one page (e.g. header + footer)
  // never collide on the gradient's id.
  const gradId = useId();
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 40 40" className="size-8 shrink-0" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="8" y1="24" x2="34" y2="8" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--coral)" />
            <stop offset="0.5" stopColor="var(--marigold)" />
            <stop offset="1" stopColor="var(--tulsi)" />
          </linearGradient>
        </defs>
        <circle cx="8" cy="24" r="4.2" fill="var(--coral)" />
        <path d="M8 24 L16 32 L34 8" fill="none" stroke={`url(#${gradId})`} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {showText ? (
        <span className="text-lg font-extrabold tracking-tight text-foreground">
          Neev
        </span>
      ) : null}
    </span>
  );
}
