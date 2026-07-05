"use client";

import { useLocale, useTranslations } from "next-intl";
import { routing } from "@/i18n/routing";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const t = useTranslations("Nav");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("language")}</span>
      <select
        value={locale}
        onChange={(e) => router.replace(pathname, { locale: e.target.value })}
        className="rounded-md border border-input bg-background px-2 py-1"
      >
        {routing.locales.map((loc) => (
          <option key={loc} value={loc}>
            {loc === "hi" ? "हिन्दी" : "English"}
          </option>
        ))}
      </select>
    </label>
  );
}
