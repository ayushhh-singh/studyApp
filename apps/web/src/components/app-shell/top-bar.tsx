import { Search, Sun, Moon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { StreakFlame } from "@/components/ui-x/streak-flame";
import { NotificationBell } from "@/components/app-shell/notification-bell";
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

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:gap-3 sm:px-6">
      <h1 className="flex-1 truncate text-base font-semibold sm:text-lg">{title}</h1>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="hidden items-center gap-2 text-muted-foreground sm:inline-flex"
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
        className="sm:hidden"
        aria-label={t("TopBar.search")}
        onClick={() => setPaletteOpen(true)}
      >
        <Search className="size-4" aria-hidden />
      </Button>

      <StreakFlame count={profile?.streak_count ?? 0} />

      <NotificationBell />

      <div className="flex items-center gap-0.5 rounded-full border border-border p-0.5">
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

      <Button type="button" variant="ghost" size="icon" aria-label={t("TopBar.toggleTheme")} onClick={toggleTheme}>
        {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      </Button>
    </header>
  );
}
