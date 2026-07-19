import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "@/stores/theme-store";

/**
 * Lazily renders a Mermaid diagram for a study chapter (Session 28). The mermaid
 * library (~large, pulls d3) is dynamically imported ONLY when a chapter actually
 * has a diagram, so it never enters the main bundle or any route that has no
 * diagram. securityLevel 'strict' + no raw HTML keeps model-authored source safe.
 * On any parse error it degrades to the raw source in a <pre> rather than blanking.
 */
let counter = 0;

export function MermaidDiagram({ source, caption }: { source: string; caption?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const dark = useThemeStore((s) => s.theme === "dark");
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const id = `mmd-${counter++}`;
        if (!ref.current) return;
        // Passing our own container is load-bearing, not cosmetic: with no
        // container, mermaid.render() builds (and, on a parse error, LEAVES
        // BEHIND) its scratch DOM directly under document.body — outside
        // React's tree entirely. On a genuine parse failure mermaid doesn't
        // reject; it draws its own "Syntax error in text" bomb-icon SVG into
        // that scratch node and only THEN throws, so the orphaned error
        // graphic never gets cleaned up and sits, permanently visible, at
        // the bottom of the page — surviving even a client-side route
        // change to a totally different chapter, since React never owned
        // that node. Rendering into our own ref means the same failure still
        // draws that graphic, but INSIDE a node React unmounts the instant
        // `error` flips true (the ternary below swaps it out for the <pre>
        // fallback), so nothing is ever left orphaned in document.body.
        const { svg } = await mermaid.render(id, source.trim(), ref.current);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [source, dark]);

  return (
    <figure className="my-4 rounded-xl border border-border bg-muted/20 p-3">
      {error ? (
        <pre className="overflow-x-auto rounded bg-muted/50 p-3 text-xs text-foreground/70">{source}</pre>
      ) : (
        <div ref={ref} className="mermaid-host flex justify-center overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto" />
      )}
      {caption ? <figcaption className="mt-2 text-center text-xs text-muted-foreground">{caption}</figcaption> : null}
    </figure>
  );
}
