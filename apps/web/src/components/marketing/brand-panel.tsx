import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The navy brand panel from docs/design/reference-1 — the tree-of-knowledge
 * mark centred on a deep navy field with a warm gold glow behind it. It is the
 * reference's hero illustration slot AND the whole left half of its
 * login/signup screen, so it lives here once rather than twice.
 *
 * The mark is the supplied RASTER (`/pwa/icon-512.png`, generated from
 * `scripts/assets/brand-mark-source.png`) — never redrawn as a vector and
 * never re-masked. It is drawn on its own rounded-square plate, so this panel
 * deliberately sits it on a navy field of the SAME family: the plate reads as
 * part of the artwork rather than as a stray app icon on a pale page.
 *
 * Navy in both themes on purpose — `--brand-navy` is one of the tokens that
 * must NOT flip (see the design skill), and the reference shows this panel
 * navy in its light and dark sheets alike. Everything inside it is therefore
 * written against that fixed field, not against `--foreground`.
 */
export function BrandPanel({
  children,
  className,
  imageClassName,
}: {
  children?: ReactNode;
  className?: string;
  imageClassName?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden rounded-3xl bg-brand-navy p-6 sm:p-8",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 size-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,var(--brand-gold)/22%,transparent_65%)]"
      />
      <img
        src="/pwa/icon-512.png"
        alt=""
        aria-hidden
        width={512}
        height={512}
        className={cn("mx-auto w-40 max-w-full object-contain sm:w-56", imageClassName)}
      />
      {children}
    </div>
  );
}
