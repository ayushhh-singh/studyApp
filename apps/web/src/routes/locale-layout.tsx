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
  }, [locale, i18n]);

  return <Outlet />;
}
