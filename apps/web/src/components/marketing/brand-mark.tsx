import { cn } from "@/lib/utils";

/**
 * Wordmark: a supplied raster mark (scripts/assets/brand-mark-source.png —
 * a student reading an open book, gradient-ringed in the score gauge's own
 * coral->marigold->tulsi band), not a hand-drawn SVG. scripts/generate-pwa-icons.mjs
 * resizes the same source into every favicon/PWA icon size; this reuses the
 * 192px copy rather than shipping a duplicate file.
 *
 * The source image has its own opaque off-white background baked in (it
 * isn't a transparent cutout), so it's wrapped in a fixed light chip here —
 * NOT `bg-background`, which would flip dark in dark mode and mismatch the
 * image's own white margin, producing a visible seam. Used on the sidebar,
 * landing hero, auth, and onboarding.
 */
export function BrandMark({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className="size-8 shrink-0 overflow-hidden rounded-lg bg-[#F7F9FC] shadow-sm">
        <img src="/pwa/icon-192.png" alt="" className="size-full object-cover" />
      </span>
      {showText ? (
        <span className="text-lg font-extrabold tracking-tight text-foreground">
          Neev
        </span>
      ) : null}
    </span>
  );
}
