import { useEffect, useState } from "react";

const KEY = "sukoon-visit-count";
const MAX_TRACKED = 99; // no need to keep counting once well past any install-prompt threshold

function readCount(): number {
  try {
    return Number(localStorage.getItem(KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function bump(): number {
  const next = Math.min(readCount() + 1, MAX_TRACKED);
  try {
    localStorage.setItem(KEY, String(next));
  } catch {
    /* best-effort — the in-memory value below still reflects this visit */
  }
  return next;
}

// Module-level guard so React StrictMode's dev-only double-invoke of effects
// can't double-count a single real page load.
let countedThisLoad = false;

/**
 * Counts standalone-Sukoon page loads (persisted across sessions in
 * localStorage) — the install-prompt's "wait until the 3rd visit" gate
 * (sukoon-install-prompt.tsx) reads this so a first-time visitor isn't asked
 * to commit before they know if this calm space is for them.
 */
export function useSukoonVisitCount(): number {
  const [count, setCount] = useState(readCount);
  useEffect(() => {
    if (countedThisLoad) return;
    countedThisLoad = true;
    setCount(bump());
  }, []);
  return count;
}
