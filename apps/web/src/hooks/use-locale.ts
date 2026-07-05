import { useParams } from "react-router";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/lib/locale";

export function useLocale(): Locale {
  const { locale } = useParams<{ locale: string }>();
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}
