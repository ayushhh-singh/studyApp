import { Link, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/providers/auth-provider";
import { useLocale } from "@/hooks/use-locale";
import { SUPPORTED_LOCALES, switchLocale, LOCALE_STORAGE_KEY, type Locale } from "@/lib/locale";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/marketing/brand-mark";
import { AccountMenu } from "@/components/app-shell/account-menu";
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

        {/* ⚑ `lg`, NOT `md` — PRE-EXISTING overflow, measured. At exactly 768px
            the inline row needs 740px of content but the container offers 720
            (768 minus `sm:px-6`), so the marketing pages scrolled horizontally by
            28px from 768 to ~819px. Session 8 moved this switch from `sm` to `md`
            to fix the same class at 640-703px; that shifted the boundary rather
            than removing it, and a sixth link ("Resources") was added afterwards.
            Below `lg` the same links live in the scrolling second row, which is
            what that row is for. Verified: without the inline nav the header
            needs 252px, and at `lg` it has 976. */}
        <nav className="hidden items-center gap-6 lg:flex" aria-label={t("Footer.headerNavLabel")}>
          {links.map((l) => navLink(l.to, l.label))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-3">
          {/* ⚑ Hidden below `sm` WHEN SIGNED IN, because the account menu beside
              it already carries a language row at exactly that breakpoint
              (AccountMenu's `sm:hidden` items) — showing both is the duplication,
              and showing neither is impossible. It also buys back ~68px, which is
              what a 320px signed-in header was overflowing by once the avatar
              joined the row. Signed OUT there is no menu, so the pill stays at
              every width. Same shape as the app shell's TopBar, which folds
              language and theme into the menu below `sm` for the same reason. */}
          <div
            className={cn(
              "h-9 items-center gap-0.5 rounded-full border border-border p-0.5",
              session ? "hidden sm:flex" : "flex",
            )}
          >
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
              <Button asChild size="sm" className="h-9">
                <Link to={`/${locale}/dashboard`}>{t("Landing.goToApp")}</Link>
              </Button>
              {/* THE app-shell account menu, not a lookalike. The first cut was a
                  plain Link to /profile, on the reasoning that AccountMenu also
                  carries locale and would duplicate the toggle to its left. That
                  was wrong twice over: the menu's language row is `sm:hidden`, so
                  on DESKTOP the menu is only name/email + Profile + Sign out and
                  there was never any duplication — and below `sm` the right fix
                  is to hide the PILL (see above), not to strip the menu. A
                  control that looks exactly like the app's account avatar must
                  behave like it: tapping it opens the menu, it does not silently
                  navigate to /profile. */}
              <AccountMenu />
            </>
          ) : (
            <>
              {/* The reference's Login + Sign Up pair. Both land on the one
                  combined /auth screen; `?mode=signup` opens it on the
                  create-account side so the two buttons aren't the same click
                  wearing different labels. Log-in is hidden below `sm` — at
                  390px the row already carries the brand, the locale toggle
                  and the primary CTA, and /auth's own toggle is one tap away. */}
              <Button asChild size="sm" variant="ghost" className="hidden h-9 sm:inline-flex">
                <Link to={`/${locale}/auth`}>{t("Landing.signIn")}</Link>
              </Button>
              <Button asChild size="sm" className="h-9">
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
        className="flex items-center gap-5 overflow-x-auto border-t border-border/60 px-4 py-2 lg:hidden"
        aria-label={t("Footer.headerNavLabel")}
      >
        {links.map((l) => navLink(l.to, l.label))}
      </nav>
    </header>
  );
}
