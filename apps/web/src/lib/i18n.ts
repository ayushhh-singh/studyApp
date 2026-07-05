import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import hi from "@/messages/hi.json";
import en from "@/messages/en.json";
import { DEFAULT_LOCALE } from "@/lib/locale";

void i18next.use(initReactI18next).init({
  resources: {
    hi: { translation: hi },
    en: { translation: en },
  },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
});

export default i18next;
