import { useTranslation } from "react-i18next";
import { CheckCircle2, Download } from "lucide-react";
import { SectionCard } from "@/components/ui-x/section-card";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/use-install-prompt";
import { isIosDevice, isStandaloneDisplay } from "@/lib/pwa-platform";

/**
 * The full-picture Settings entry point for installing the PWA — pairs
 * with `PwaInstallButton` (a quiet TopBar icon for the common one-tap
 * case, same split as `NotificationBell` + `PushNotificationsCard`) by
 * additionally covering the states a tiny header icon can't: an
 * already-installed confirmation, and manual instructions for the
 * non-Chromium browsers `beforeinstallprompt` never fires in. Reuses
 * `useInstallPrompt()` rather than re-implementing `beforeinstallprompt`
 * capture.
 */
export function InstallAppCard() {
  const { t } = useTranslation();
  const { canInstall, promptInstall, isPrompting, installed } = useInstallPrompt();

  // `installed` (the `appinstalled` event) covers "just installed via the
  // button below, still viewing it in this same browser tab" — a state
  // `isStandaloneDisplay()` alone can't see, since the tab doesn't become
  // standalone until relaunched from the installed icon.
  if (isStandaloneDisplay() || installed) {
    return (
      <SectionCard title={t("Pwa.installSectionTitle")}>
        <p className="flex items-center gap-2 text-sm text-tulsi-foreground">
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          {t("Pwa.installAlready")}
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title={t("Pwa.installSectionTitle")} description={t("Pwa.installDescription")}>
      {canInstall ? (
        <Button
          type="button"
          className="w-fit gap-2"
          onClick={() => void promptInstall()}
          disabled={isPrompting}
        >
          <Download className="size-4" aria-hidden />
          {t("Pwa.installCta")}
        </Button>
      ) : (
        // beforeinstallprompt is Chromium-only — Safari and Firefox never
        // fire it even when the app is genuinely installable, so this isn't
        // an error state. Show the manual path instead of hiding the card.
        <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          {isIosDevice() ? t("Pwa.installIosInstructions") : t("Pwa.installManualInstructions")}
        </p>
      )}
    </SectionCard>
  );
}
