import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router";
import { Compass, Download, Moon, ShieldAlert, Sun } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/hooks/use-locale";
import { useUpdateProfile } from "@/hooks/use-profile";
import { useTourState, useUpdateTourState } from "@/hooks/use-tour";
import { getAccessToken } from "@/lib/auth";
import { LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, switchLocale, type Locale } from "@/lib/locale";
import { useThemeStore } from "@/stores/theme-store";
import { cn } from "@/lib/utils";

const API_URL = import.meta.env.VITE_API_URL as string;

export function SettingsCard() {
  const { t } = useTranslation();
  const locale = useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const updateProfile = useUpdateProfile();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const tourQuery = useTourState();
  const updateTour = useUpdateTourState();
  const checklistDismissed = tourQuery.data?.tour_state.dismissed ?? false;

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  function handleLocaleSwitch(next: Locale) {
    if (next === locale) return;
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
    updateProfile.mutate({ preferred_locale: next });
    navigate(switchLocale(location.pathname, location.search, next, location.hash));
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      // Raw fetch (not lib/api.ts) because the response is a file blob, not the
      // {data,error} JSON envelope api.ts expects — but it still needs the same
      // bearer token every other authenticated call attaches.
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/api/v1/profile/export`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "neev-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : t("Profile.settingsExportError"));
    } finally {
      setExporting(false);
    }
  }

  return (
    <SectionCard>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
        <div className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm font-medium">{t("Profile.settingsLanguage")}</span>
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
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm font-medium">{t("Profile.settingsTheme")}</span>
            <Button type="button" variant="outline" size="sm" onClick={toggleTheme} className="gap-2">
              {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
              {theme === "dark" ? t("Profile.settingsThemeLight") : t("Profile.settingsThemeDark")}
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("Profile.settingsExport")}</span>
                <span className="text-xs text-muted-foreground">{t("Profile.settingsExportHint")}</span>
              </div>
              <Button type="button" variant="outline" size="sm" onClick={handleExport} disabled={exporting} className="gap-2">
                <Download className="size-4" aria-hidden />
                {exporting ? t("Profile.settingsExporting") : t("Profile.settingsExportButton")}
              </Button>
            </div>
            {exportError && <p className="text-sm text-destructive">{exportError}</p>}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("Profile.settingsShowChecklist")}</span>
                <span className="text-xs text-muted-foreground">{t("Profile.settingsShowChecklistHint")}</span>
              </div>
              <Button
                type="button"
                variant={checklistDismissed ? "outline" : "default"}
                size="sm"
                onClick={() => updateTour.mutate({ dismissed: !checklistDismissed })}
                aria-pressed={!checklistDismissed}
              >
                {checklistDismissed ? t("Profile.settingsShowChecklistBringBack") : t("Profile.settingsShowChecklistOn")}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{t("Profile.settingsReplayTour")}</span>
                <span className="text-xs text-muted-foreground">{t("Profile.settingsReplayTourHint")}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => updateTour.mutate({ reset: true })}
                disabled={updateTour.isPending}
                className="gap-2"
              >
                <Compass className="size-4" aria-hidden />
                {t("Profile.settingsReplayTourButton")}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-coral/30 bg-coral/5 p-3">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-coral-foreground">
              <ShieldAlert className="size-4" aria-hidden />
              {t("Profile.dangerZoneTitle")}
            </span>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{t("Profile.dangerZoneHint")}</span>
              <Button type="button" variant="destructive" size="sm" disabled title={t("Profile.dangerZoneHint")}>
                {t("Profile.deleteAccount")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
