import { DropdownMenu } from "radix-ui";
import { useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Languages, LogOut, Moon, Sparkles, Sun, User as UserIcon } from "lucide-react";
import { useAuth } from "@/providers/auth-provider";
import { useProfile } from "@/hooks/use-profile";
import { useLocale } from "@/hooks/use-locale";
import { useUpdateProfile } from "@/hooks/use-profile";
import { LOCALE_STORAGE_KEY, switchLocale, type Locale } from "@/lib/locale";
import { useThemeStore } from "@/stores/theme-store";

function initialOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = name?.trim() || email?.trim() || "?";
  return source.charAt(0).toUpperCase();
}

export function AccountMenu() {
  const { t } = useTranslation();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut, isGuest } = useAuth();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const theme = useThemeStore((st) => st.theme);
  const toggleTheme = useThemeStore((st) => st.toggleTheme);

  // Mirrors TopBar's own handler — same three writes (localStorage, profile,
  // URL) so the two entry points can't drift.
  function handleLocaleSwitch(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    updateProfile.mutate({ preferred_locale: next });
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  async function handleSignOut() {
    await signOut();
    navigate(`/${locale}`, { replace: true });
  }

  function goSignup() {
    const redirect = `${location.pathname}${location.search}`;
    navigate(`/${locale}/auth?redirect=${encodeURIComponent(redirect)}`);
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={t("TopBar.account")}
          className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isGuest ? initialOf(t("Guest.short"), null) : initialOf(profile?.display_name, user?.email)}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          {isGuest ? (
            <>
              <div className="px-2.5 py-2">
                <p className="text-sm font-semibold">{t("Guest.browsingAsGuest")}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t("Guest.sameDeviceNote")}</p>
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                onSelect={goSignup}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-semibold text-primary outline-none focus:bg-primary/10"
              >
                <Sparkles className="size-4" /> {t("Guest.createAccountCta")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => navigate(`/${locale}/profile`)}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent"
              >
                <UserIcon className="size-4" /> {t("Nav.profile")}
              </DropdownMenu.Item>
              {/* Language and theme live here BELOW sm only — see TopBar, where
                  the matching buttons are hidden at the same breakpoint. At
                  320px the header cannot hold the brand mark, the page title,
                  the exam chip and seven icon controls at once: measured, the
                  title box collapsed to 0px and even the avatar was being
                  squeezed from 36px to 20px. Folding the two preference
                  toggles into the menu they conventionally belong in returns
                  ~76px, which restores the title to the ~8-character floor
                  TopBar documents. Both stay one tap away. */}
              <DropdownMenu.Separator className="my-1 h-px bg-border sm:hidden" />
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  handleLocaleSwitch(locale === "hi" ? "en" : "hi");
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent sm:hidden"
              >
                <Languages className="size-4" /> {t("TopBar.toggleLanguage")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  toggleTheme();
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent sm:hidden"
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}{" "}
                {t("TopBar.toggleTheme")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => void handleSignOut()}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-coral outline-none focus:bg-coral/10"
              >
                <LogOut className="size-4" /> {t("Guest.exit")}
              </DropdownMenu.Item>
            </>
          ) : (
            <>
              <div className="px-2.5 py-2">
                <p className="truncate text-sm font-semibold">{profile?.display_name ?? t("TopBar.account")}</p>
                {user?.email ? <p className="truncate text-xs text-muted-foreground">{user.email}</p> : null}
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                onSelect={() => navigate(`/${locale}/profile`)}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent"
              >
                <UserIcon className="size-4" /> {t("Nav.profile")}
              </DropdownMenu.Item>
              {/* Language and theme live here BELOW sm only — see TopBar, where
                  the matching buttons are hidden at the same breakpoint. At
                  320px the header cannot hold the brand mark, the page title,
                  the exam chip and seven icon controls at once: measured, the
                  title box collapsed to 0px and even the avatar was being
                  squeezed from 36px to 20px. Folding the two preference
                  toggles into the menu they conventionally belong in returns
                  ~76px, which restores the title to the ~8-character floor
                  TopBar documents. Both stay one tap away. */}
              <DropdownMenu.Separator className="my-1 h-px bg-border sm:hidden" />
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  handleLocaleSwitch(locale === "hi" ? "en" : "hi");
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent sm:hidden"
              >
                <Languages className="size-4" /> {t("TopBar.toggleLanguage")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={(e) => {
                  e.preventDefault();
                  toggleTheme();
                }}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none focus:bg-accent sm:hidden"
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}{" "}
                {t("TopBar.toggleTheme")}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                onSelect={() => void handleSignOut()}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-coral outline-none focus:bg-coral/10"
              >
                <LogOut className="size-4" /> {t("TopBar.signOut")}
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
