import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, switchLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/brand-mark";
import { cn } from "@/lib/utils";

/**
 * Shared header for the public marketing pages (landing, pricing, about, faq).
 * Carries the primary top-nav links (About / FAQ / Pricing) so a signed-out
 * visitor can reach them without scrolling to the footer — visible in the bar
 * on desktop, and on a compact second row on mobile (the header is too tight
 * at 390px to fit them inline alongside the locale toggle + auth CTA). The
 * footer keeps the same links too, per standard convention.
 */
export function MarketingHeader({ maxWidthClass = "max-w-6xl" }: { maxWidthClass?: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const { session } = useAuth();

  function setLocale(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  const links = [
    { to: `/${locale}/about`, label: t("Footer.about") },
    { to: `/${locale}/faq`, label: t("Footer.faq") },
    { to: `/${locale}/pricing`, label: t("Footer.pricing") },
  ];
  const isActive = (to: string) => location.pathname === to || location.pathname === `${to}/`;

  const navLink = (to: string, label: string) => (
    <Link
      key={to}
      to={to}
      aria-current={isActive(to) ? "page" : undefined}
      className={cn(
        "text-sm font-medium transition-colors hover:text-foreground",
        isActive(to) ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
      <div className={cn("mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-6", maxWidthClass)}>
        <Link to={`/${locale}`} aria-label={t("Landing.brand")} className="shrink-0">
          <BrandMark />
        </Link>

        <nav className="hidden items-center gap-6 sm:flex" aria-label={t("Footer.navLabel")}>
          {links.map((l) => navLink(l.to, l.label))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
            {SUPPORTED_LOCALES.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLocale(l)}
                aria-pressed={l === locale}
                className={cn(
                  "min-h-8 rounded-full px-2.5 text-xs font-semibold uppercase transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  l === locale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {l}
              </button>
            ))}
          </div>
          <Button asChild size="sm">
            <Link to={session ? `/${locale}/dashboard` : `/${locale}/auth`}>
              {session ? t("Landing.goToApp") : t("Landing.signIn")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Mobile-only nav row — keeps About/FAQ/Pricing reachable at 390px without
          overflowing the top bar or forcing a scroll to the footer. */}
      <nav
        className="flex items-center justify-center gap-6 border-t border-border/60 px-4 py-2 sm:hidden"
        aria-label={t("Footer.navLabel")}
      >
        {links.map((l) => navLink(l.to, l.label))}
      </nav>
    </header>
  );
}
