import { cn } from "@/lib/utils";

/**
 * Wordmark: a supplied raster mark (scripts/assets/brand-mark-source.png — a
 * glowing tree of knowledge, roots below/branches above, a child reading at
 * the trunk), not a hand-drawn SVG. scripts/generate-pwa-icons.mjs composes
 * the same source into every favicon/PWA icon size; this reuses the 192px copy
 * rather than shipping a duplicate file.
 *
 * The icon is a rounded SQUARE plate (navy, gold rim), NOT a circle — this
 * comment used to say circle, describing docs/design/reference-3's NAVIGATION
 * badge rather than our own artwork; the circle-mask that would have matched it
 * was tried during the 2026-08 refresh and reverted, because masking a rounded
 * square to a circle clips its corners and cuts through the rim (see
 * scripts/generate-pwa-icons.mjs). Either way the mark is self-contained and
 * needs no wrapper chip: it reads correctly on a light and a dark surface
 * alike, which is why nothing here is theme-conditional.
 *
 * The wordmark stays "Neev", not the reference images' "NeevStudy" — the
 * English/Devanagari wordmark pair is decided in exactly one place (CLAUDE.md
 * "Branding"), and renaming the product is a deliberate change of its own,
 * not a side effect of restyling. Used on the sidebar, mobile top bar, landing
 * hero, auth, and onboarding.
 */
export function BrandMark({
  className,
  showText = true,
  size = "md",
}: {
  className?: string;
  showText?: boolean;
  /** `sm` is the mobile top-bar chip, where the row also carries the page title. */
  size?: "sm" | "md";
}) {
  return (
    <span className={cn("inline-flex items-center", size === "sm" ? "gap-2" : "gap-2.5", className)}>
      <img
        src="/pwa/icon-192.png"
        alt=""
        className={cn("shrink-0 object-contain", size === "sm" ? "size-7" : "size-8")}
      />
      {showText ? (
        <span
          className={cn(
            "font-heading font-extrabold tracking-tight text-foreground",
            size === "sm" ? "text-base" : "text-lg",
          )}
        >
          Neev
        </span>
      ) : null}
    </span>
  );
}
