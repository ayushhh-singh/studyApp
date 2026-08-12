import { cn } from "@/lib/utils";

/**
 * Wordmark: a supplied raster mark (scripts/assets/brand-mark-source.png — a
 * glowing tree of knowledge, roots below/branches above, a child reading at
 * the trunk), not a hand-drawn SVG. scripts/generate-pwa-icons.mjs composes
 * the same source into every favicon/PWA icon size; this reuses the 192px copy
 * rather than shipping a duplicate file.
 *
 * As of the 2026-08 brand refresh that icon is a CIRCLE (navy badge, gold rim
 * — docs/design/reference-3's NAVIGATION panels), so the mark is self-contained
 * and needs no wrapper chip: it reads correctly on a light and a dark surface
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
