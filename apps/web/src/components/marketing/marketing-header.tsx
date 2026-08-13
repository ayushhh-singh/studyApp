import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/providers/auth-provider";
import { useProfile } from "@/hooks/use-profile";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, switchLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/brand-mark";
import { cn } from "@/lib/utils";

/**
 * Shared header for the public marketing pages (landing, pricing, about, faq,
 * contact). Carries the primary top-nav links so a signed-out
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
  // Only fetched when signed in — a marketing page must never fire a doomed
  // authed request for a visitor who has no session (the same `enabled` gate
  // /pricing already uses for its subscription query).
  const { data: profile } = useProfile({ enabled: !!session });

  function setLocale(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  const links = [
    { to: `/${locale}/features`, label: t("Footer.features") },
    { to: `/${locale}/resources`, label: t("Footer.resources") },
    { to: `/${locale}/about`, label: t("Footer.about") },
    { to: `/${locale}/faq`, label: t("Footer.faq") },
    { to: `/${locale}/pricing`, label: t("Footer.pricing") },
    { to: `/${locale}/contact`, label: t("Footer.contact") },
  ];
  const isActive = (to: string) => location.pathname === to || location.pathname === `${to}/`;

  // Active marker is a filled RULE under the label plus a bolder weight —
  // never colour alone (docs/design/reference-1's header).
  //
  // The bar is --action (navy in light, gold in dark), matching `ui/tabs.tsx`'s
  // `variant="underline"` exactly, NOT the sidebar's raw --marigold. The
  // sidebar's gold bar sits on a filled active row; here it would sit straight
  // on --background, where #F7C873 measures 1.48:1 — an underline nobody can
  // see. --action is the token that stays a legible filled surface in both
  // themes, and it still lands gold in dark, which is where the reference's
  // dark sheet shows gold.
  const navLink = (to: string, label: string) => (
    <Link
      key={to}
      to={to}
      aria-current={isActive(to) ? "page" : undefined}
      className={cn(
        "relative shrink-0 py-1 text-sm transition-colors hover:text-foreground",
        isActive(to) ? "font-semibold text-foreground" : "font-medium text-muted-foreground",
      )}
    >
      {label}
      {isActive(to) ? (
        <span
          aria-hidden
          className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-action"
        />
      ) : null}
    </Link>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/90 backdrop-blur">
      <div className={cn("mx-auto flex h-14 items-center justify-between gap-4 px-4 sm:px-6", maxWidthClass)}>
        <Link to={`/${locale}`} aria-label={t("Landing.brand")} className="shrink-0">
          <BrandMark />
        </Link>

        <nav className="hidden items-center gap-6 md:flex" aria-label={t("Footer.headerNavLabel")}>
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
          {session ? (
            <>
              <Button asChild size="sm">
                <Link to={`/${locale}/dashboard`}>{t("Landing.goToApp")}</Link>
              </Button>
              {/* Profile avatar beside "Go to dashboard", so a signed-in visitor
                  on a marketing page has the same account affordance the app
                  shell gives them everywhere else — and one that goes somewhere
                  DIFFERENT from the button next to it (dashboard vs profile),
                  rather than being a second way to click the same thing.

                  Deliberately a plain Link to /profile, not the app shell's
                  AccountMenu: that menu carries sign-out, theme and locale, and
                  two locale controls in one header (the toggle sits immediately
                  to its left) is the kind of duplication the landing header was
                  just cleaned up to remove. The initial comes from `profile`,
                  which is why this renders "?" for the moment before it loads
                  rather than flashing a wrong letter. */}
              <Link
                to={`/${locale}/profile`}
                aria-label={t("TopBar.account")}
                title={profile?.display_name ?? t("TopBar.account")}
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(profile?.display_name?.trim() || session.user?.email?.trim() || "?").charAt(0).toUpperCase()}
              </Link>
            </>
          ) : (
            <>
              {/* The reference's Login + Sign Up pair. Both land on the one
                  combined /auth screen; `?mode=signup` opens it on the
                  create-account side so the two buttons aren't the same click
                  wearing different labels. Log-in is hidden below `sm` — at
                  390px the row already carries the brand, the locale toggle
                  and the primary CTA, and /auth's own toggle is one tap away. */}
              <Button asChild size="sm" variant="ghost" className="hidden md:inline-flex">
                <Link to={`/${locale}/auth`}>{t("Landing.signIn")}</Link>
              </Button>
              <Button asChild size="sm">
                <Link to={`/${locale}/auth?mode=signup`}>{t("Landing.signUp")}</Link>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Mobile-only nav row — keeps the section links reachable at 390px
          without overflowing the top bar or forcing a scroll to the footer.
          Scrolls rather than wraps: five links at 390px do not fit, and the
          same fix the five-tab Practice bar needed applies here.

          The switch is at `md`, not `sm`: with five links AND the Log in +
          Sign up pair, the single-row layout needs 704px in English, so it
          overflowed the viewport between 640 and 703px. Hindi's labels are
          shorter and fit, which is why this only showed up in one locale. */}
      <nav
        className="flex items-center gap-5 overflow-x-auto border-t border-border/60 px-4 py-2 md:hidden"
        aria-label={t("Footer.headerNavLabel")}
      >
        {links.map((l) => navLink(l.to, l.label))}
      </nav>
    </header>
  );
}
