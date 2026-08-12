import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The navy brand panel from docs/design/reference-1 — the tree-of-knowledge
 * artwork on a deep navy field with a warm gold glow behind it. It is the
 * reference's hero illustration slot AND the whole left half of its
 * login/signup screen, so it lives here once rather than twice.
 *
 * THE ART IS THE HERO ASSET, NOT THE APP ICON. `scripts/generate-hero-art.mjs`
 * takes the same logo raster and fades its edges so it bleeds into this panel.
 * The icon does not work here: the logo is drawn on its own rounded-SQUARE
 * plate with a bright rim-light baked in (the rim peaks at luminance 253 along
 * the top), so rendering it inside this panel's own rounded navy container
 * produced two concentric rounded rectangles with a lit rim between them — an
 * app icon dropped onto the page, which is the opposite of what this docblock
 * used to claim it did.
 *
 * This does not redraw, re-shape or re-mask THE LOGO. Every logo slot (/pwa/*,
 * favicon, and BrandMark's nav chip) still comes from generate-pwa-icons.mjs
 * and is byte-identical; the standing "never re-shape the mark" rule is about
 * the mark, and the hero asset is a separate illustration.
 *
 * ONE ASSET SERVES BOTH CONTEXTS, and that was checked rather than assumed.
 * The auth panel looked like a candidate for the tighter icon treatment — it
 * could plausibly want to echo the installed app icon — but rendered side by
 * side the bleed wins there too: at the ~288px this panel gives it, the plate
 * stops reading as "the app icon" and starts reading as artwork with a stray
 * frame, adrift in a tall navy field. The icon echo on that screen is already
 * carried by <BrandMark> in the form column's header, at a real icon size
 * (32px) where it actually reads as one. If a contained-icon treatment is ever
 * wanted here, add it as a variant then — don't reintroduce it untested.
 *
 * Navy in both themes on purpose — `--brand-navy` is one of the tokens that
 * must NOT flip (see the design skill), and the reference shows this panel
 * navy in its light and dark sheets alike. Everything inside it is therefore
 * written against that fixed field, not against `--foreground`.
 */
export function BrandPanel({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-3xl bg-brand-navy p-3 sm:p-4",
        className,
      )}
    >
      {/* Softer and wider than the icon-era glow (was 22%/34rem): with the
          plate gone there is no longer a lit rim competing with it, so the
          same intensity read as a bright wash around the tree. */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--brand-gold)/16%,transparent_68%)]"
      />
      {/* Runs nearer the panel edge than the icon did: with no plate, the
          artwork's own silhouette is its boundary, so it has to be larger to
          read as hero artwork rather than as a small object centred in a box.
          The asset's outer ~8% is transparent fade, so the visible tree still
          keeps a real margin from the panel edge at every width. */}
      <img
        src="/brand/tree-hero.webp"
        alt=""
        aria-hidden
        width={1024}
        height={1024}
        className="mx-auto w-full max-w-[21rem] object-contain sm:max-w-[26rem] lg:max-w-[30rem]"
      />
      {children}
    </div>
  );
}
