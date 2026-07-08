import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A product screenshot in a browser-frame mock. Screenshots live in
 * /public/marketing and are captured from the real running app. If one is
 * missing, we degrade to a branded gradient panel rather than a broken image.
 */
export function Screenshot({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-primary/5 ring-1 ring-black/5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/60 px-3.5 py-2.5">
        <span className="size-2.5 rounded-full bg-coral/70" />
        <span className="size-2.5 rounded-full bg-marigold/70" />
        <span className="size-2.5 rounded-full bg-tulsi/70" />
      </div>
      {errored ? (
        <div className="flex aspect-[4/3] items-center justify-center bg-gradient-to-br from-primary/10 via-background to-marigold/10">
          <span className="text-sm font-medium text-muted-foreground">{alt}</span>
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          width={1200}
          height={900}
          onError={() => setErrored(true)}
          className="block aspect-[4/3] w-full object-cover"
        />
      )}
    </div>
  );
}
