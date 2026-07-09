import { useEffect, useState } from "react";

/**
 * SSR-safe media query listener — returns `false` until mount (the app is a
 * pure CSR SPA, so there's no server-rendered mismatch to worry about, but
 * `window` still isn't available during the initial render pass).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}
