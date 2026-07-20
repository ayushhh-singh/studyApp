import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { useLocale } from "@/hooks/use-locale";
import { BrandMark } from "@/components/marketing/brand-mark";

export const SUPPORT_EMAIL = "support@neevstudy.com";

/**
 * Persistent footer shared across the public marketing pages (landing,
 * pricing, about, faq) AND the signed-in app-shell — one component so About/
 * FAQ/Pricing/support stay reachable no matter which side of auth a user is
 * on, rather than duplicating this markup per route.
 */
export function Footer() {
  const { t } = useTranslation();
  const locale = useLocale();

  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <Link to={`/${locale}`} aria-label={t("Landing.brand")} className="shrink-0">
            <BrandMark />
          </Link>
          <nav aria-label={t("Footer.navLabel")} className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5">
            <Link to={`/${locale}/about`} className="transition-colors hover:text-foreground">
              {t("Footer.about")}
            </Link>
            <Link to={`/${locale}/faq`} className="transition-colors hover:text-foreground">
              {t("Footer.faq")}
            </Link>
            <Link to={`/${locale}/pricing`} className="transition-colors hover:text-foreground">
              {t("Footer.pricing")}
            </Link>
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <Mail className="size-3.5 shrink-0" aria-hidden />
              {SUPPORT_EMAIL}
            </a>
          </nav>
        </div>
        <p className="text-center text-xs sm:text-left">{t("Landing.footer")}</p>
      </div>
    </footer>
  );
}
