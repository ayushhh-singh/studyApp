import { useEffect } from "react";
import { Outlet, redirect, type LoaderFunctionArgs } from "react-router";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, isLocale } from "@/lib/locale";
import { useLocale } from "@/hooks/use-locale";

export function loader({ params }: LoaderFunctionArgs) {
  if (!isLocale(params.locale)) {
    throw redirect(`/${DEFAULT_LOCALE}`);
  }
  return null;
}

export function Component() {
  const locale = useLocale();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (i18n.language !== locale) {
      void i18n.changeLanguage(locale);
    }
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    // vite-plugin-pwa injects the English manifest link at build time; swap
    // it to the static Hindi manifest (public/manifest.hi.webmanifest) so
    // "Add to home screen" installs with the right name/description — the
    // Web App Manifest spec has no built-in i18n, so two static files + this
    // runtime swap is the pragmatic bilingual approach.
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) link.href = locale === "hi" ? "/manifest.hi.webmanifest" : "/manifest.webmanifest";
  }, [locale, i18n]);

  return <Outlet />;
}
