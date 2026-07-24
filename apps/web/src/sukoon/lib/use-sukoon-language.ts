import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

export type SukoonLanguage = "hi" | "en";

const STORAGE_KEY = "sukoon-language";

function readStored(): SukoonLanguage | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "hi" || stored === "en" ? stored : null;
  } catch {
    return null;
  }
}

interface SukoonLanguageStore {
  /** null until the first mount seeds it (from localStorage, then the :locale hint). */
  language: SukoonLanguage | null;
  setLanguage: (next: SukoonLanguage) => void;
  /** Seed once from a fallback if nothing is stored yet (no-op afterwards). */
  seed: (fallback: SukoonLanguage) => void;
}

/**
 * SHARED reactive store for Sukoon's display language.
 *
 * Previously this hook held per-component `useState`, so toggling the language
 * in the header updated ONLY the header (+ localStorage) while every other
 * Sukoon component kept its own stale copy until it happened to remount — i.e.
 * the hi/en toggle appeared broken across the module. A single zustand store
 * makes one toggle re-render every consumer at once, matching Neev's global
 * toggle behaviour.
 *
 * Still deliberately NOT wired to Neev's `:locale` URL param (standalone mode
 * has no locale segment, and F1 makes this a per-profile preference) — it reuses
 * the same i18next instance/resources, passing an explicit `lng` override per
 * `t()` call so it never mutates the global i18next language (which would leak
 * into a Neev page rendered elsewhere in the same session).
 */
const useLanguageStore = create<SukoonLanguageStore>((set, get) => ({
  // Read synchronously at store creation so a stored preference has no
  // first-render flash. Guarded (readStored catches) for non-browser contexts.
  language: readStored(),
  setLanguage: (next) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable — keep the in-memory value */
    }
    set({ language: next });
  },
  seed: (fallback) => {
    if (get().language === null) set({ language: readStored() ?? fallback });
  },
}));

/**
 * Sukoon's language preference + a locale-scoped `t()`. `language` is now shared
 * across every consumer, so `setLanguage` from anywhere (e.g. the header) updates
 * the whole Sukoon subtree in one render.
 *
 * The ONE-TIME `:locale` seed (integrated mode: landing on /hi/sukoon with no
 * prior Sukoon visit opens in Hindi) runs on first mount only; once a real
 * preference is stored, the hint is never consulted again. `useParams` degrades
 * to `undefined` in standalone mode.
 */
export function useSukoonLanguage() {
  const { t: rawT } = useTranslation();
  const { locale } = useParams<{ locale?: string }>();

  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const seed = useLanguageStore((s) => s.seed);

  useEffect(() => {
    seed(locale === "hi" ? "hi" : "en");
  }, [seed, locale]);

  // Before the seed lands, fall back to the URL hint so the very first paint is
  // already correct rather than defaulting to English regardless of the URL.
  const effective: SukoonLanguage = language ?? (locale === "hi" ? "hi" : "en");

  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => rawT(key, { lng: effective, ...options }),
    [rawT, effective],
  );

  return { language: effective, setLanguage, t };
}
