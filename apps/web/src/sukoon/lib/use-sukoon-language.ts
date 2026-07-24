import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";

export type SukoonLanguage = "hi" | "en";

const STORAGE_KEY = "sukoon-language";

function readStored(fallback: SukoonLanguage): SukoonLanguage {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "hi" || stored === "en" ? stored : fallback;
}

/**
 * Sukoon's own language preference — deliberately NOT LIVE-wired to Neev's
 * `:locale` URL param (useLocale/switchLocale), since (a) standalone mode has
 * no locale segment at all, and (b) the blueprint's F1 onboarding makes this
 * a per-profile setting, not a URL concern. Reuses the SAME i18next instance
 * and messages/{hi,en}.json resources as the rest of the app (per CLAUDE.md's
 * i18n rule) — every `t()` call here just passes an explicit `lng` override
 * instead of calling `i18n.changeLanguage()`, so toggling this never mutates
 * the global instance and can't leak into a Neev page rendered elsewhere in
 * the same session.
 *
 * The ONE-TIME exception: on a user's very first visit (nothing in
 * localStorage yet), the initial value is seeded from the current `:locale`
 * segment when one is present (integrated mode) — landing on /hi/sukoon with
 * no prior Sukoon visit should open in Hindi, not silently default to
 * English regardless of the URL the user actually arrived on. `useParams`
 * degrades to `undefined` with no error in standalone mode (no such route
 * param exists there), so this stays safe at both mount points. Once a real
 * preference is stored, this hint is never consulted again.
 */
export function useSukoonLanguage() {
  const { t: rawT } = useTranslation();
  const { locale } = useParams<{ locale?: string }>();
  const [language, setLanguageState] = useState<SukoonLanguage>(() =>
    readStored(locale === "hi" ? "hi" : "en"),
  );

  const setLanguage = useCallback((next: SukoonLanguage) => {
    localStorage.setItem(STORAGE_KEY, next);
    setLanguageState(next);
  }, []);

  const t = useCallback(
    (key: string, options?: Record<string, unknown>) => rawT(key, { lng: language, ...options }),
    [rawT, language],
  );

  return { language, setLanguage, t };
}
