import { useEffect, useRef, useState } from "react";

/**
 * Autosaves `value` to localStorage under `key` at most once every
 * `intervalMs`. The interval is set up once per key (not restarted on every
 * keystroke) — it reads the latest value via a ref on each tick instead, so
 * continuous typing doesn't perpetually defer the save.
 */
export function useDraftAutosave(key: string, value: string, intervalMs = 5000): number | null {
  const valueRef = useRef(value);
  valueRef.current = value;
  const lastSaved = useRef(value);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      if (valueRef.current !== lastSaved.current) {
        try {
          localStorage.setItem(key, valueRef.current);
        } catch {
          // localStorage unavailable (private mode / quota) — draft just won't survive a reload.
        }
        lastSaved.current = valueRef.current;
        setSavedAt(Date.now());
      }
    }, intervalMs);
    return () => clearInterval(interval);
  }, [key, intervalMs]);

  return savedAt;
}

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore — nothing to clear if storage was never available
  }
}
