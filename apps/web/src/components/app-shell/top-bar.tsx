import { Languages, Search, Sun, Moon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { StreakFlame } from "@/components/ui-x/streak-flame";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { AccountMenu } from "@/components/app-shell/account-menu";
import { useLocale } from "@/hooks/use-locale";
import { useProfile, useUpdateProfile } from "@/hooks/use-profile";
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, switchLocale, type Locale } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { useThemeStore } from "@/stores/theme-store";

export function TopBar({ title }: { title: string }) {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const setPaletteOpen = useCommandPaletteStore((s) => s.setOpen);

  function handleLocaleSwitch(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    updateProfile.mutate({ preferred_locale: next });
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  // gap-0.5/px-2 below sm (not gap-1/px-3): at the smallest realistic phone
  // (320px) with the six always-visible icon controls plus the longest real
  // title ("Current Affairs"), the previous gap-1/px-3 left only ~58px for
  // the title — enough for ~5 legible characters before the ellipsis, short
  // of the ~8-10 char floor. The extra ~22px this reclaims (14px of gaps +
  // 8px of padding) clears 8 characters with room to spare, confirmed live.
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-0.5 border-b border-border bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 sm:px-6">
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold lg:text-lg">{title}</h1>

      {/* The "wide" controls below (search-with-kbd, streak count, full
          locale pill) switch on at `lg`, not `sm` — the sidebar
          (sidebar.tsx, `w-60`/240px) only appears at `md` (768px), so a
          `sm` (640px) switch turns these on BEFORE the sidebar exists, then
          the sidebar's 240px lands on top of that once `md` hits, and the
          title gets crushed to single-digit pixel widths in the 640-900px
          band (confirmed live: title box width dropped to 11px at 768px
          with the old `sm` breakpoint). `lg` (1024px) leaves enough room
          even after the sidebar's 240px is subtracted. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="hidden items-center gap-2 text-muted-foreground lg:inline-flex"
        onClick={() => setPaletteOpen(true)}
      >
        <Search className="size-4" aria-hidden />
        {t("TopBar.search")}
        <kbd className="ml-1 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
          {t("TopBar.searchShortcut")}
        </kbd>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t("TopBar.search")}
        onClick={() => setPaletteOpen(true)}
      >
        <Search className="size-4" aria-hidden />
      </Button>

      {/* Below lg, drop the streak count text — the flame alone (tap target
          unchanged) frees up real width for the title; the number comes back
          once there's room. */}
      <StreakFlame count={profile?.streak_count ?? 0} className="px-2 [&_span]:hidden lg:px-3 lg:[&_span]:inline" />

      <NotificationBell />

      {/* Full EN/HI pill only fits at lg+; below that it collapses to one
          icon-only toggle button (title on this same row needs the width). */}
      <div className="hidden items-center gap-0.5 rounded-full border border-border p-0.5 lg:flex">
        {SUPPORTED_LOCALES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => handleLocaleSwitch(l)}
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
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t("TopBar.toggleLanguage")}
        onClick={() => handleLocaleSwitch(locale === "hi" ? "en" : "hi")}
      >
        <Languages className="size-4" aria-hidden />
      </Button>

      <Button type="button" variant="ghost" size="icon" aria-label={t("TopBar.toggleTheme")} onClick={toggleTheme}>
        {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      </Button>

      <AccountMenu />
    </header>
  );
}
