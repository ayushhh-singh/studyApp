import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/stores/install-prompt-store";

/**
 * Quiet, always-in-view entry point in the sticky TopBar for installing the
 * PWA — renders nothing unless the browser has actually fired
 * `beforeinstallprompt` (Chromium-only, and only once genuine
 * installability criteria are met). Mirrors `NotificationBell`'s role: a
 * small icon here for the common one-tap case, with the full picture
 * (manual instructions for non-Chromium browsers, an "already installed"
 * confirmation) living in `InstallAppCard` under Profile > Settings — same
 * split as `NotificationBell` + `PushNotificationsCard`.
 */
export function PwaInstallButton() {
  const { t } = useTranslation();
  const { canInstall, promptInstall, isPrompting } = useInstallPrompt();

  if (!canInstall) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t("Pwa.installCta")}
      title={t("Pwa.installCta")}
      disabled={isPrompting}
      onClick={() => void promptInstall()}
    >
      <Download className="size-4" aria-hidden />
    </Button>
  );
}
