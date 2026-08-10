import { cn } from "@/lib/utils";

/**
 * Wordmark: a supplied raster mark (scripts/assets/brand-mark-source.png — a
 * glowing tree of knowledge, roots below/branches above, a child reading at
 * the trunk), not a hand-drawn SVG. scripts/generate-pwa-icons.mjs resizes
 * the same source into every favicon/PWA icon size; this reuses the 192px
 * copy rather than shipping a duplicate file.
 *
 * Unlike the two previous source images, this one has real alpha
 * transparency around its own rounded-square artwork (no opaque background
 * baked in), so it's rendered directly with no wrapper chip — a light chip
 * would add an unwanted border around content that's already self-contained
 * and reads fine on both a light and dark surface. Used on the sidebar,
 * landing hero, auth, and onboarding.
 */
export function BrandMark({ className, showText = true }: { className?: string; showText?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <img src="/pwa/icon-192.png" alt="" className="size-8 shrink-0 object-contain" />
      {showText ? (
        <span className="text-lg font-extrabold tracking-tight text-foreground">
          Neev
        </span>
      ) : null}
    </span>
  );
}
